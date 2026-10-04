// Undo and the eraser for drawings on PDF pages.
//
// The reading engine draws with fabric.js (public/lib/fabric-js, loaded in
// index.html before the app) but keeps its canvases to itself. Recording each
// canvas as it's created lets Folio remove objects from it; the engine
// listens for "object:removed" on its canvases and saves the change itself.
declare var window: any;

const canvases: any[] = [];
// Objects drawn while drawing mode is on, newest last, for undo
let history: { canvas: any; object: any }[] = [];
let isRecording = false;
let isErasing = false;

const liveCanvases = () => {
  // Drop canvases whose page was closed or re-rendered
  for (let i = canvases.length - 1; i >= 0; i--) {
    if (!canvases[i].lowerCanvasEl?.isConnected) canvases.splice(i, 1);
  }
  return canvases;
};

// The object under a tap: the engine may make objects non-interactive when
// it isn't drawing, so this doesn't rely on fabric's own targeting
const objectAt = (canvas: any, event: Event) => {
  const point = canvas.getPointer(event);
  const objects = canvas.getObjects();
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].containsPoint(point, null, true)) return objects[i];
  }
  return null;
};

const watchCanvas = (canvas: any) => {
  canvas.on("object:added", (event: any) => {
    if (isRecording && event.target) {
      history.push({ canvas, object: event.target });
    }
  });
  canvas.on("mouse:down", (event: any) => {
    if (!isErasing || !event.e) return;
    const object = event.target || objectAt(canvas, event.e);
    if (object) {
      canvas.remove(object);
      canvas.requestRenderAll();
    }
  });
};

export const installAnnotationCanvasRegistry = () => {
  const fabric = window.fabric;
  if (!fabric?.Canvas || fabric.Canvas.prototype.__folioRegistry) return;
  const initialize = fabric.Canvas.prototype.initialize;
  fabric.Canvas.prototype.initialize = function (...args: any[]) {
    const result = initialize.apply(this, args);
    canvases.push(this);
    watchCanvas(this);
    return result;
  };
  fabric.Canvas.prototype.__folioRegistry = true;
};

// Drawing mode on: what's drawn from now on can be undone
export const setAnnotationRecording = (recording: boolean) => {
  isRecording = recording;
  if (!recording) {
    history = [];
    isErasing = false;
  }
};

export const undoAnnotation = () => {
  while (history.length > 0) {
    const { canvas, object } = history.pop()!;
    if (
      canvas.lowerCanvasEl?.isConnected &&
      canvas.getObjects().includes(object)
    ) {
      canvas.remove(object);
      canvas.requestRenderAll();
      return true;
    }
  }
  return false;
};

// Eraser: a tap on a drawing removes it. Drawing is switched off on every
// canvas meanwhile, so the tap doesn't also start a stroke.
export const setAnnotationEraser = (erasing: boolean) => {
  isErasing = erasing;
  for (const canvas of liveCanvases()) {
    if (erasing) {
      canvas.isDrawingMode = false;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }
  }
};
