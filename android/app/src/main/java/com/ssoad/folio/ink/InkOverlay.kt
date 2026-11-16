package com.ssoad.folio.ink

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.RectF
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import androidx.ink.authoring.InProgressStrokeId
import androidx.ink.authoring.InProgressStrokesFinishedListener
import androidx.ink.authoring.InProgressStrokesView
import androidx.ink.brush.Brush
import androidx.ink.brush.InputToolType
import androidx.ink.brush.StockBrushes
import androidx.ink.strokes.Stroke
import androidx.ink.strokes.StrokeInput

/**
 * Low-latency ink over the reader's WebView.
 *
 * While a pen tool is on, touches that draw are taken here and the stroke
 * is drawn straight to the screen (front-buffered, androidx.ink), a frame
 * or so behind the finger or pen. When it's finished it goes to the page
 * (listener.onStroke), which stores and draws it; the page then releases
 * the native copy, so it never flickers.
 *
 * - A stylus always draws; fingers draw only with "draw with finger" on,
 *   and otherwise scroll the page as usual.
 * - A second finger cancels the stroke and hands the gesture to the page
 *   (two-finger scroll and pinch).
 * - The stylus eraser end, or the side button, erases (listener.onErase).
 * - Touches that start on the toolbar (passThrough rects) go to the page.
 */
@SuppressLint("ViewConstructor")
class InkOverlay(
    context: Context,
    private val webView: View,
    private val listener: Listener,
) : FrameLayout(context) {

    interface Listener {
        fun onStroke(id: String, stroke: Stroke, tool: String, offsetX: Float, offsetY: Float)
        fun onErase(points: FloatArray, isStart: Boolean, isEnd: Boolean)
        fun onStylusSeen()
    }

    private val strokesView = InProgressStrokesView(context)

    var isActive = false
    var tool = "pen"
    var colorArgb = 0xFF1F2937.toInt()
    var sizePx = 6f
    var drawWithFinger = true
    var passThrough: List<RectF> = emptyList()

    private var stylusSeen = false
    private var currentId: InProgressStrokeId? = null
    private var currentPointer = -1
    private var isErasing = false
    // A gesture handed to the WebView (two fingers, or a finger while
    // drawing is stylus-only) goes there until every finger is up
    private var isForwarding = false
    private var isIgnoring = false

    private val pending = HashMap<String, InProgressStrokeId>()
    private var nextId = 0

    init {
        addView(strokesView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        strokesView.addFinishedStrokesListener(
            object : InProgressStrokesFinishedListener {
                override fun onStrokesFinished(strokes: Map<InProgressStrokeId, Stroke>) {
                    val location = IntArray(2)
                    val webLocation = IntArray(2)
                    getLocationOnScreen(location)
                    webView.getLocationOnScreen(webLocation)
                    for ((strokeId, stroke) in strokes) {
                        val id = "s" + (nextId++)
                        pending[id] = strokeId
                        listener.onStroke(
                            id,
                            stroke,
                            tool,
                            (location[0] - webLocation[0]).toFloat(),
                            (location[1] - webLocation[1]).toFloat(),
                        )
                        // If the page never takes it, don't leave it on screen
                        postDelayed({ release(listOf(id)) }, 4000)
                    }
                }
            }
        )
    }

    /** The page has drawn these strokes: remove the native copies */
    fun release(ids: List<String>) {
        val strokeIds = ids.mapNotNull { pending.remove(it) }.toSet()
        if (strokeIds.isNotEmpty()) strokesView.removeFinishedStrokes(strokeIds)
    }

    private fun brush(): Brush {
        val family = when (tool) {
            "marker" -> StockBrushes.highlighter()
            "pencil" -> StockBrushes.marker()
            else -> StockBrushes.pressurePen()
        }
        return Brush.createWithColorIntArgb(family, colorArgb, sizePx, 0.1f)
    }

    private fun isStylus(event: MotionEvent, index: Int): Boolean {
        val type = event.getToolType(index)
        return type == MotionEvent.TOOL_TYPE_STYLUS || type == MotionEvent.TOOL_TYPE_ERASER
    }

    private fun wantsEraser(event: MotionEvent, index: Int): Boolean =
        event.getToolType(index) == MotionEvent.TOOL_TYPE_ERASER ||
            (isStylus(event, index) &&
                (event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0)

    private fun isPassThrough(x: Float, y: Float): Boolean {
        val density = resources.displayMetrics.density
        val cx = x / density
        val cy = y / density
        return passThrough.any { it.contains(cx, cy) }
    }

    private fun forward(event: MotionEvent) {
        val copy = MotionEvent.obtain(event)
        val location = IntArray(2)
        val webLocation = IntArray(2)
        getLocationOnScreen(location)
        webView.getLocationOnScreen(webLocation)
        copy.offsetLocation(
            (location[0] - webLocation[0]).toFloat(),
            (location[1] - webLocation[1]).toFloat(),
        )
        webView.dispatchTouchEvent(copy)
        copy.recycle()
    }

    private fun eraserPoints(event: MotionEvent, index: Int): FloatArray {
        val density = resources.displayMetrics.density
        val out = FloatArray((event.historySize + 1) * 2)
        for (h in 0 until event.historySize) {
            out[h * 2] = event.getHistoricalX(index, h) / density
            out[h * 2 + 1] = event.getHistoricalY(index, h) / density
        }
        out[event.historySize * 2] = event.getX(index) / density
        out[event.historySize * 2 + 1] = event.getY(index) / density
        return out
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (!isActive) return false
        val action = event.actionMasked
        if (action == MotionEvent.ACTION_DOWN) {
            isForwarding = false
            isIgnoring = false
            isErasing = false
            currentId = null
            val stylus = isStylus(event, 0)
            if (stylus && !stylusSeen) {
                stylusSeen = true
                listener.onStylusSeen()
            }
            if (isPassThrough(event.x, event.y)) {
                // The toolbar: not ours at all
                return false
            }
            if (!stylus && !drawWithFinger) {
                // Stylus-only drawing: fingers scroll and turn pages
                return false
            }
            requestUnbufferedDispatch(event)
            if (wantsEraser(event, 0)) {
                isErasing = true
                listener.onErase(eraserPoints(event, 0), true, false)
                return true
            }
            currentPointer = event.getPointerId(0)
            currentId = strokesView.startStroke(event, currentPointer, brush())
            return true
        }
        if (isIgnoring) return true
        if (isForwarding) {
            forward(event)
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                isForwarding = false
            }
            return true
        }
        when (action) {
            MotionEvent.ACTION_POINTER_DOWN -> {
                // Two fingers: scroll or zoom the page instead of drawing
                currentId?.let { strokesView.cancelStroke(it, event) }
                currentId = null
                if (isErasing) {
                    listener.onErase(FloatArray(0), false, true)
                    isErasing = false
                }
                if (isStylus(event, event.actionIndex)) {
                    isIgnoring = true
                    return true
                }
                isForwarding = true
                // The page sees the gesture from its start
                val down = MotionEvent.obtain(event.downTime, event.eventTime,
                    MotionEvent.ACTION_DOWN, event.getX(0), event.getY(0), event.metaState)
                forward(down)
                down.recycle()
                forward(event)
            }
            MotionEvent.ACTION_MOVE -> {
                if (isErasing) {
                    listener.onErase(eraserPoints(event, 0), false, false)
                } else currentId?.let {
                    strokesView.addToStroke(event, currentPointer, it)
                }
            }
            MotionEvent.ACTION_UP -> {
                if (isErasing) {
                    listener.onErase(FloatArray(0), false, true)
                    isErasing = false
                } else currentId?.let {
                    strokesView.finishStroke(event, currentPointer, it)
                }
                currentId = null
            }
            MotionEvent.ACTION_CANCEL -> {
                currentId?.let { strokesView.cancelStroke(it, event) }
                currentId = null
                if (isErasing) listener.onErase(FloatArray(0), false, true)
                isErasing = false
            }
        }
        return true
    }

    companion object {
        fun toolTypeName(input: StrokeInput): String = when (input.toolType) {
            InputToolType.STYLUS -> "stylus"
            InputToolType.TOUCH -> "touch"
            InputToolType.MOUSE -> "mouse"
            else -> "unknown"
        }

        @Suppress("unused")
        fun now() = SystemClock.uptimeMillis()
    }
}
