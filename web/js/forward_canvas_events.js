// DOM widgets are overlaid on ComfyUI's graph <canvas>, so wheel/pinch events over
// them never reach it and the browser zooms the whole page. Forward them to the
// graph canvas so LiteGraph pans/zooms like it does everywhere else.
export function forwardCanvasEvents(root) {
    root.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            document.getElementById("graph-canvas")?.dispatchEvent(
                new WheelEvent("wheel", {
                    deltaX: e.deltaX,
                    deltaY: e.deltaY,
                    deltaMode: e.deltaMode,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    ctrlKey: e.ctrlKey,
                    bubbles: true,
                    cancelable: true,
                })
            );
        },
        { passive: false }
    );
    // Safari's trackpad-pinch gesture events have no LiteGraph equivalent.
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) root.addEventListener(type, (e) => e.preventDefault());
}

// The right-hand properties panel draws node widgets itself and writes its own
// panel width into widget.width, which would stretch a DOM widget past its node.
// Pin it to undefined so the frontend sizes the widget from the node width.
export function ignoreWidgetWidth(widget) {
    Object.defineProperty(widget, "width", { get: () => undefined, set: () => {}, configurable: true });
}
