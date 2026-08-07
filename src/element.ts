import { RollingNumberCore } from './core';

export class RollingNumberElement extends HTMLElement {
  private core: RollingNumberCore | null = null;

  static get observedAttributes(): string[] {
    return ['value', 'pad', 'max'];
  }

  constructor() {
    super();
  }

  connectedCallback(): void {
    if (!this.core) {
      this.core = new RollingNumberCore(this, {
        value: this.hasAttribute('value') ? Number(this.getAttribute('value')) : 0,
        pad: this.hasAttribute('pad') ? Number(this.getAttribute('pad')) : 1,
        max: this.hasAttribute('max') ? Number(this.getAttribute('max')) : null
      });
    }
  }

  disconnectedCallback(): void {
    if (this.core) {
      this.core.destroy();
      this.core = null;
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.core) return;

    if (name === 'value') {
      this.core.setValue(newValue !== null ? Number(newValue) : 0);
    } else if (name === 'pad') {
      this.core.setPad(newValue !== null ? Number(newValue) : 1);
    } else if (name === 'max') {
      this.core.setMax(newValue !== null ? Number(newValue) : null);
    }
  }

  // Getter and Setter properties for programmatic usage in JS/Frameworks
  get value(): number {
    return this.core ? this.core.getValue() : Number(this.getAttribute('value') ?? 0);
  }

  set value(val: number) {
    this.setAttribute('value', val.toString());
    if (this.core) {
      this.core.setValue(val);
    }
  }

  get pad(): number {
    return this.hasAttribute('pad') ? Number(this.getAttribute('pad')) : 1;
  }

  set pad(val: number) {
    this.setAttribute('pad', val.toString());
    if (this.core) {
      this.core.setPad(val);
    }
  }

  get max(): number | null {
    return this.hasAttribute('max') ? Number(this.getAttribute('max')) : null;
  }

  set max(val: number | null) {
    if (val === null) {
      this.removeAttribute('max');
    } else {
      this.setAttribute('max', val.toString());
    }
    if (this.core) {
      this.core.setMax(val);
    }
  }
}

/**
 * Registers the `<rolling-number>` custom element if not already defined.
 */
export function defineRollingNumber(tagName: string = 'rolling-number'): void {
  if (typeof window !== 'undefined' && 'customElements' in window) {
    if (!customElements.get(tagName)) {
      customElements.define(tagName, RollingNumberElement);
    }
  }
}
