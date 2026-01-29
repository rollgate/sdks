import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { Subscription } from "rxjs";
import { RollgateService } from "./rollgate.service";

/**
 * Structural directive to conditionally render content based on a feature flag.
 *
 * @example
 * ```html
 * <div *rollgateFlag="'new-feature'">
 *   This content shows when 'new-feature' is enabled
 * </div>
 *
 * <ng-container *rollgateFlag="'premium-feature'; else standardTpl">
 *   Premium content
 * </ng-container>
 * <ng-template #standardTpl>Standard content</ng-template>
 * ```
 */
@Directive({
  selector: "[rollgateFlag]",
  standalone: true,
})
export class FlagDirective implements OnInit, OnDestroy {
  private flagKey = "";
  private hasView = false;
  private subscription?: Subscription;

  @Input()
  set rollgateFlag(flagKey: string) {
    this.flagKey = flagKey;
    this.updateView();
  }

  @Input()
  rollgateFlagElse?: TemplateRef<unknown>;

  constructor(
    private templateRef: TemplateRef<unknown>,
    private viewContainer: ViewContainerRef,
    private rollgate: RollgateService,
  ) {}

  ngOnInit(): void {
    this.subscription = this.rollgate.getFlag$(this.flagKey).subscribe(() => {
      this.updateView();
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private updateView(): void {
    const isEnabled = this.rollgate.isEnabled(this.flagKey);

    if (isEnabled && !this.hasView) {
      this.viewContainer.clear();
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!isEnabled && this.hasView) {
      this.viewContainer.clear();
      if (this.rollgateFlagElse) {
        this.viewContainer.createEmbeddedView(this.rollgateFlagElse);
      }
      this.hasView = false;
    } else if (!isEnabled && !this.hasView && this.rollgateFlagElse) {
      this.viewContainer.clear();
      this.viewContainer.createEmbeddedView(this.rollgateFlagElse);
    }
  }
}
