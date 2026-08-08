import './rolling-number.css';

export interface RollingNumberOptions {
  /** The initial numeric value to display. Default: 0 */
  value?: number;
  /** Minimum number of digit columns — pads with leading zeros. Default: 1 */
  pad?: number;
  /** Clamp the displayed value to this maximum (e.g. 99 for a notification badge). Default: null */
  max?: number | null;
  /** Whether to progressively interpolate values through intermediate numbers. Default: true */
  interpolate?: boolean;
  /** Animation duration in milliseconds when interpolate is true. Default: 400 */
  duration?: number;
}

export class RollingNumberCore {
  private container: HTMLElement;
  private value: number;
  private displayValue: number;
  private pad: number;
  private max: number | null;
  private interpolate: boolean;
  private duration: number;

  private signEl: HTMLSpanElement | null = null;
  private digitCols: HTMLSpanElement[] = [];
  private animFrameId: number | null = null;

  constructor(container: HTMLElement, options: RollingNumberOptions = {}) {
    if (!(container instanceof HTMLElement)) {
      throw new Error('[RollingNumber] Target container must be a valid HTMLElement.');
    }

    this.container = container;
    this.value = Number(options.value ?? 0);
    this.displayValue = this.value;
    this.pad = Math.max(1, Math.floor(options.pad ?? 1));
    this.max = options.max !== undefined && options.max !== null ? Number(options.max) : null;
    this.interpolate = options.interpolate ?? true;
    this.duration = options.duration ?? 400;

    this.initDOM();
    this.render();
  }

  /**
   * Initializes the container root accessibility attributes and class names.
   */
  private initDOM(): void {
    if (!this.container.classList.contains('rn-rolling-number')) {
      this.container.classList.add('rn-rolling-number');
    }
    this.container.setAttribute('role', 'img');
  }

  /**
   * Calculates the clamped positive integer display value.
   */
  private getDisplayValue(): number {
    const rounded = Math.round(this.displayValue);
    const absVal = Math.abs(rounded);
    return this.max !== null ? Math.min(absVal, this.max) : absVal;
  }

  /**
   * Returns array of single digit characters zero-padded to `pad` length.
   */
  private getDisplayDigits(): string[] {
    const str = this.getDisplayValue().toString();
    const targetLength = Math.max(this.pad, str.length);
    return str.padStart(targetLength, '0').split('');
  }

  /**
   * Builds a single digit column element containing the sizer and digits scale (0..9).
   */
  private createColumnElement(digit: string): HTMLSpanElement {
    const col = document.createElement('span');
    col.className = 'rn-col';
    col.setAttribute('data-digit', digit);

    // Sizer to hold proper column layout dimensions
    const sizer = document.createElement('span');
    sizer.className = 'rn-sizer';
    sizer.setAttribute('aria-hidden', 'true');
    sizer.textContent = digit;

    // Vertical digit scale (0 to 9)
    const scale = document.createElement('span');
    scale.className = 'rn-scale';
    scale.setAttribute('aria-hidden', 'true');

    for (let i = 0; i <= 9; i++) {
      const cell = document.createElement('span');
      cell.className = 'rn-cell';
      cell.textContent = i.toString();
      scale.appendChild(cell);
    }

    col.appendChild(sizer);
    col.appendChild(scale);
    return col;
  }

  /**
   * Renders and updates the DOM using fast element reconciliation.
   */
  /**
   * Renders and updates the DOM using fast element reconciliation.
   */
  public render(): void {
    const isNegative = Math.round(this.displayValue) < 0;
    const digits = this.getDisplayDigits();

    // Accessibility label
    this.container.setAttribute('aria-label', Math.round(this.value).toString());

    // 1. Handle Minus Sign
    if (isNegative) {
      if (!this.signEl) {
        this.signEl = document.createElement('span');
        this.signEl.className = 'rn-sign';
        this.signEl.setAttribute('aria-hidden', 'true');
        this.signEl.textContent = '−';
        this.container.prepend(this.signEl);
      }
    } else {
      if (this.signEl) {
        this.signEl.remove();
        this.signEl = null;
      }
    }

    // 2. Reconcile Digit Columns count
    const currentCount = this.digitCols.length;
    const targetCount = digits.length;

    if (currentCount < targetCount) {
      // Append missing columns
      for (let i = currentCount; i < targetCount; i++) {
        const col = this.createColumnElement(digits[i]);
        this.digitCols.push(col);
        this.container.appendChild(col);
      }
    } else if (currentCount > targetCount) {
      // Remove excess columns from the right/end
      for (let i = currentCount - 1; i >= targetCount; i--) {
        const col = this.digitCols.pop();
        col?.remove();
      }
    }

    // 3. Update data-digit and sizer text on existing columns
    for (let i = 0; i < targetCount; i++) {
      const col = this.digitCols[i];
      const digit = digits[i];
      if (col.getAttribute('data-digit') !== digit) {
        col.setAttribute('data-digit', digit);
        const sizer = col.querySelector<HTMLSpanElement>('.rn-sizer');
        if (sizer) {
          sizer.textContent = digit;
        }
      }
    }
  }

  /**
   * Updates the displayed numeric value with optional progressive interpolation.
   */
  public setValue(value: number, animate: boolean = this.interpolate): void {
    const targetVal = Number(value);
    if (this.value === targetVal && this.displayValue === targetVal) return;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (!animate || this.duration <= 0) {
      this.container.classList.remove('rn-interpolating');
      this.value = targetVal;
      this.displayValue = targetVal;
      this.render();
      return;
    }

    const startVal = this.displayValue;
    const delta = targetVal - startVal;
    this.value = targetVal;

    if (Math.abs(delta) < 0.001) {
      this.displayValue = targetVal;
      this.render();
      return;
    }

    this.container.classList.add('rn-interpolating');
    const startTime = performance.now();
    const duration = this.duration;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // easeOutCubic curve
      const ease = 1 - Math.pow(1 - progress, 3);

      this.displayValue = startVal + delta * ease;
      this.render();

      if (progress < 1) {
        this.animFrameId = requestAnimationFrame(step);
      } else {
        this.displayValue = targetVal;
        this.render();
        this.container.classList.remove('rn-interpolating');
        this.animFrameId = null;
      }
    };

    this.animFrameId = requestAnimationFrame(step);
  }

  /**
   * Gets the current numeric target value.
   */
  public getValue(): number {
    return this.value;
  }

  /**
   * Updates whether value changes are progressively interpolated.
   */
  public setInterpolate(interpolate: boolean): void {
    this.interpolate = Boolean(interpolate);
  }

  /**
   * Updates the animation duration in milliseconds.
   */
  public setDuration(duration: number): void {
    this.duration = Math.max(0, Number(duration));
  }

  /**
   * Updates the column zero-padding minimum length.
   */
  public setPad(pad: number): void {
    const newPad = Math.max(1, Math.floor(pad));
    if (this.pad === newPad) return;
    this.pad = newPad;
    this.render();
  }

  /**
   * Updates the maximum clamped limit.
   */
  public setMax(max: number | null): void {
    const newMax = max !== null ? Number(max) : null;
    if (this.max === newMax) return;
    this.max = newMax;
    this.render();
  }

  /**
   * Updates multiple options at once.
   */
  public update(options: RollingNumberOptions): void {
    if (options.pad !== undefined && this.pad !== options.pad) {
      this.pad = Math.max(1, Math.floor(options.pad));
    }
    if (options.max !== undefined && this.max !== options.max) {
      this.max = options.max !== null ? Number(options.max) : null;
    }
    if (options.interpolate !== undefined) {
      this.interpolate = Boolean(options.interpolate);
    }
    if (options.duration !== undefined) {
      this.duration = Math.max(0, Number(options.duration));
    }

    if (options.value !== undefined && this.value !== options.value) {
      this.setValue(options.value);
    } else {
      this.render();
    }
  }

  /**
   * Destroys the instance and empties the container DOM.
   */
  public destroy(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.container.classList.remove('rn-interpolating');
    this.container.innerHTML = '';
    this.digitCols = [];
    this.signEl = null;
  }
}
