import './rolling-number.css';

export interface RollingNumberOptions {
  /** The initial numeric value to display. Default: 0 */
  value?: number;
  /** Minimum number of digit columns — pads with leading zeros. Default: 1 */
  pad?: number;
  /** Clamp the displayed value to this maximum (e.g. 99 for a notification badge). Default: null */
  max?: number | null;
}

export class RollingNumberCore {
  private container: HTMLElement;
  private value: number;
  private pad: number;
  private max: number | null;

  private signEl: HTMLSpanElement | null = null;
  private digitCols: HTMLSpanElement[] = [];

  constructor(container: HTMLElement, options: RollingNumberOptions = {}) {
    if (!(container instanceof HTMLElement)) {
      throw new Error('[RollingNumber] Target container must be a valid HTMLElement.');
    }

    this.container = container;
    this.value = Number(options.value ?? 0);
    this.pad = Math.max(1, Math.floor(options.pad ?? 1));
    this.max = options.max !== undefined && options.max !== null ? Number(options.max) : null;

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
    const rounded = Math.round(this.value);
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
  public render(): void {
    const isNegative = Math.round(this.value) < 0;
    const digits = this.getDisplayDigits();

    // Accessibility label
    this.container.setAttribute('aria-label', this.value.toString());

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
   * Updates the displayed numeric value.
   */
  public setValue(value: number): void {
    if (this.value === value) return;
    this.value = Number(value);
    this.render();
  }

  /**
   * Gets the current numeric value.
   */
  public getValue(): number {
    return this.value;
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
    let changed = false;

    if (options.value !== undefined && this.value !== options.value) {
      this.value = Number(options.value);
      changed = true;
    }
    if (options.pad !== undefined && this.pad !== options.pad) {
      this.pad = Math.max(1, Math.floor(options.pad));
      changed = true;
    }
    if (options.max !== undefined && this.max !== options.max) {
      this.max = options.max !== null ? Number(options.max) : null;
      changed = true;
    }

    if (changed) {
      this.render();
    }
  }

  /**
   * Destroys the instance and empties the container DOM.
   */
  public destroy(): void {
    this.container.innerHTML = '';
    this.digitCols = [];
    this.signEl = null;
  }
}
