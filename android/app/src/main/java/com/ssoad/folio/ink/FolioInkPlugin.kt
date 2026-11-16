package com.ssoad.folio.ink

import android.graphics.RectF
import android.view.ViewGroup
import androidx.ink.strokes.Stroke
import androidx.ink.strokes.StrokeInput
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray

/**
 * The page's side of the native ink layer (src/utils/reader/nativeInk.ts).
 *
 * configure: turns the layer on or off and sets the tool, colour, size,
 * finger drawing and the toolbar areas touches pass through to.
 * Events: "stroke" (a finished stroke in CSS pixels of the page's viewport,
 * with pressure and tilt), "erase" (eraser points) and "stylus" (a stylus
 * was used for the first time).
 * release: the page has drawn these strokes, so the native copies go.
 */
@CapacitorPlugin(name = "FolioInk")
class FolioInkPlugin : Plugin(), InkOverlay.Listener {

    private var overlay: InkOverlay? = null

    private fun ensureOverlay(): InkOverlay {
        overlay?.let { return it }
        val webView = bridge.webView
        val parent = webView.parent as ViewGroup
        val created = InkOverlay(context, webView, this)
        parent.addView(
            created,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        overlay = created
        return created
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val active = call.getBoolean("active", false) ?: false
        activity.runOnUiThread {
            if (!active && overlay == null) {
                call.resolve()
                return@runOnUiThread
            }
            val view = ensureOverlay()
            view.isActive = active
            call.getString("tool")?.let { view.tool = it }
            call.getString("color")?.let { view.colorArgb = parseColor(it) }
            call.getFloat("size")?.let {
                view.sizePx = it * context.resources.displayMetrics.density
            }
            call.getBoolean("drawWithFinger")?.let { view.drawWithFinger = it }
            call.getArray("passThrough")?.let { view.passThrough = parseRects(it) }
            call.resolve()
        }
    }

    @PluginMethod
    fun release(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>() ?: emptyList()
        activity.runOnUiThread {
            overlay?.release(ids)
            call.resolve()
        }
    }

    // "#rrggbb" or "#aarrggbb"
    private fun parseColor(color: String): Int = try {
        android.graphics.Color.parseColor(color)
    } catch (e: IllegalArgumentException) {
        0xFF1F2937.toInt()
    }

    private fun parseRects(array: JSArray): List<RectF> {
        val rects = ArrayList<RectF>()
        for (i in 0 until array.length()) {
            val r = array.optJSONObject(i) ?: continue
            rects.add(
                RectF(
                    r.optDouble("left").toFloat(),
                    r.optDouble("top").toFloat(),
                    r.optDouble("right").toFloat(),
                    r.optDouble("bottom").toFloat(),
                )
            )
        }
        return rects
    }

    override fun onStroke(id: String, stroke: Stroke, tool: String, offsetX: Float, offsetY: Float) {
        val density = context.resources.displayMetrics.density
        val inputs = stroke.inputs
        val points = JSONArray()
        val pressures = JSONArray()
        val input = StrokeInput()
        var toolType = "touch"
        for (i in 0 until inputs.size) {
            inputs.populate(i, input)
            if (i == 0) toolType = InkOverlay.toolTypeName(input)
            points.put(((input.x + offsetX) / density).toDouble())
            points.put(((input.y + offsetY) / density).toDouble())
            pressures.put(if (input.pressure < 0) 1.0 else input.pressure.toDouble())
        }
        val data = JSObject()
        data.put("id", id)
        data.put("tool", tool)
        data.put("toolType", toolType)
        data.put("points", points)
        data.put("pressures", pressures)
        notifyListeners("stroke", data)
    }

    override fun onErase(points: FloatArray, isStart: Boolean, isEnd: Boolean) {
        val data = JSObject()
        val list = JSONArray()
        points.forEach { list.put(it.toDouble()) }
        data.put("points", list)
        data.put("start", isStart)
        data.put("end", isEnd)
        notifyListeners("erase", data)
    }

    override fun onStylusSeen() {
        notifyListeners("stylus", JSObject())
    }
}
