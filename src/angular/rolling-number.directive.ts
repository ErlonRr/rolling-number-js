import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges
} from '@angular/core';
import { RollingNumberCore } from '../core';

@Directive({
  selector: '[rollingNumber]',
  standalone: true
})
export class RollingNumberDirective implements OnInit, OnDestroy, OnChanges {
  @Input('rollingNumber') valueInput: number | string = 0;
  @Input() pad: number = 1;
  @Input() max: number | null = null;

  private core: RollingNumberCore | null = null;

  constructor(private el: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    const targetEl = this.resolveTargetElement(this.el.nativeElement);
    this.core = new RollingNumberCore(targetEl, {
      value: Number(this.valueInput ?? 0),
      pad: Number(this.pad ?? 1),
      max: this.max !== null && this.max !== undefined ? Number(this.max) : null
    });
  }

  private resolveTargetElement(el: HTMLElement): HTMLElement {
    // Handle complex UI components like PrimeNG <p-inputNumber> or Material inputs
    if (el.tagName.toLowerCase().includes('-input')) {
      let targetSpan = el.querySelector<HTMLElement>('.rn-angular-target');
      if (!targetSpan) {
        targetSpan = document.createElement('span');
        targetSpan.className = 'rn-angular-target';
        el.appendChild(targetSpan);
      }
      return targetSpan;
    }
    return el;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.core) return;

    if (changes['valueInput']) {
      this.core.setValue(Number(changes['valueInput'].currentValue ?? 0));
    }
    if (changes['pad']) {
      this.core.setPad(Number(changes['pad'].currentValue ?? 1));
    }
    if (changes['max']) {
      const maxVal = changes['max'].currentValue;
      this.core.setMax(maxVal !== null && maxVal !== undefined ? Number(maxVal) : null);
    }
  }

  ngOnDestroy(): void {
    if (this.core) {
      this.core.destroy();
      this.core = null;
    }
  }
}
