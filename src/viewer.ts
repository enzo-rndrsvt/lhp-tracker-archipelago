// Pan / zoom map viewer. The canvas is laid out in the map image's native pixel space (the same
// coordinates the pack uses for pins) and scaled with a CSS transform.
import type { MapDef, PinDef } from "./main";

const MIN_PIN_SCREEN_PX = 16;

export class MapViewer {
  onPinClick: (pin: PinDef) => void = () => {};
  onBackgroundClick: () => void = () => {};
  onViewChange: () => void = () => {};

  private map: MapDef | null = null;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private fitScale = 1;
  private pinEls = new Map<PinDef, HTMLButtonElement>();
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinchDist = 0;

  constructor(
    private stage: HTMLElement,
    private canvas: HTMLElement,
    private img: HTMLImageElement,
    private pinLayer: HTMLElement,
  ) {
    stage.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    stage.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    stage.addEventListener("pointermove", (e) => this.onPointerMove(e));
    stage.addEventListener("pointerup", (e) => this.onPointerUp(e));
    stage.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    new ResizeObserver(() => {
      if (!this.map) return;
      const wasFit = Math.abs(this.scale - this.fitScale) < 1e-6;
      this.computeFit();
      if (wasFit) this.fit();
    }).observe(stage);
  }

  setMap(map: MapDef, refit: boolean) {
    const changed = this.map?.name !== map.name;
    this.map = map;
    if (changed) {
      this.canvas.style.width = `${map.w}px`;
      this.canvas.style.height = `${map.h}px`;
      this.img.src = `${import.meta.env.BASE_URL}${map.img}`;
      this.img.alt = map.name;
      this.pinLayer.replaceChildren();
      this.pinEls.clear();
    }
    this.computeFit();
    if (changed || refit) this.fit();
  }

  renderPins(pins: PinDef[], map: MapDef, update: (pin: PinDef, el: HTMLButtonElement) => void) {
    for (const pin of pins) {
      let el = this.pinEls.get(pin);
      if (!el) {
        el = document.createElement("button");
        el.style.left = `${pin.x}px`;
        el.style.top = `${pin.y}px`;
        el.style.setProperty("--size", `${map.size}px`);
        el.append(document.createElement("span"));
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.moved < 5) this.onPinClick(pin);
        });
        this.pinEls.set(pin, el);
        this.pinLayer.append(el);
      }
      update(pin, el);
    }
  }

  fit() {
    if (!this.map) return;
    this.scale = this.fitScale;
    this.tx = (this.stage.clientWidth - this.map.w * this.scale) / 2;
    this.ty = (this.stage.clientHeight - this.map.h * this.scale) / 2;
    this.apply();
  }

  zoomBy(factor: number, cx = this.stage.clientWidth / 2, cy = this.stage.clientHeight / 2) {
    const next = Math.min(Math.max(this.scale * factor, this.fitScale * 0.5), Math.max(4, this.fitScale * 8));
    const k = next / this.scale;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.scale = next;
    this.apply();
  }

  /** Zoom in on a point of the map (image pixels) and center it. */
  focusOn(x: number, y: number) {
    const target = Math.max(this.scale, Math.min(1, this.fitScale * 3));
    this.scale = target;
    this.tx = this.stage.clientWidth / 2 - x * target;
    this.ty = this.stage.clientHeight / 2 - y * target;
    this.apply();
  }

  /** Position the popover next to a pin, kept inside the stage. */
  placePopover(popover: HTMLElement, pin: PinDef) {
    const px = this.tx + pin.x * this.scale;
    const py = this.ty + pin.y * this.scale;
    const w = popover.offsetWidth;
    const h = popover.offsetHeight;
    const sw = this.stage.clientWidth;
    const sh = this.stage.clientHeight;
    let left = px + 18;
    if (left + w > sw - 12) left = px - w - 18;
    left = Math.min(Math.max(12, left), sw - w - 12);
    const top = Math.min(Math.max(12, py - h / 2), sh - h - 12);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  private computeFit() {
    if (!this.map) return;
    const pad = 16;
    this.fitScale = Math.min(
      (this.stage.clientWidth - pad * 2) / this.map.w,
      (this.stage.clientHeight - pad * 2) / this.map.h,
    );
    if (!(this.fitScale > 0)) this.fitScale = 0.1;
  }

  private apply() {
    this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.canvas.style.setProperty("--pin-min", `${MIN_PIN_SCREEN_PX / this.scale}px`);
    this.onViewChange();
  }

  private onWheel(e: WheelEvent) {
    // Let the details bubble scroll normally.
    if ((e.target as HTMLElement).closest(".popover")) return;
    e.preventDefault();
    const rect = this.stage.getBoundingClientRect();
    this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  }

  private onPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest(".popover")) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.moved = 0;
    if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
    this.stage.classList.add("dragging");
  }

  private onPointerMove(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved += Math.abs(dx) + Math.abs(dy);
    // Capture only once a real drag starts, so clicks still reach the pins.
    if (this.moved >= 5 && !this.stage.hasPointerCapture(e.pointerId)) this.stage.setPointerCapture(e.pointerId);

    if (this.pointers.size === 2) {
      const dist = this.pinchDistance();
      const rect = this.stage.getBoundingClientRect();
      const [a, b] = [...this.pointers.values()];
      if (this.pinchDist > 0) {
        this.zoomBy(dist / this.pinchDist, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      }
      this.pinchDist = dist;
      this.tx += dx / 2;
      this.ty += dy / 2;
    } else {
      this.tx += dx;
      this.ty += dy;
    }
    this.apply();
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) {
      this.stage.classList.remove("dragging");
      const onPin = (e.target as HTMLElement).closest(".pin");
      if (this.moved < 5 && !onPin && e.type === "pointerup") this.onBackgroundClick();
    }
  }

  private pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
