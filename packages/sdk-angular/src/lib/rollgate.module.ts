import { NgModule, ModuleWithProviders } from "@angular/core";
import { RollgateService } from "./rollgate.service";
import { FlagDirective } from "./flag.directive";
import { ROLLGATE_CONFIG, type RollgateModuleConfig } from "./rollgate.config";

@NgModule({
  imports: [FlagDirective],
  exports: [FlagDirective],
})
export class RollgateModule {
  /**
   * Configure the Rollgate module for the root application.
   *
   * @example
   * ```typescript
   * @NgModule({
   *   imports: [
   *     RollgateModule.forRoot({
   *       apiKey: 'your-api-key',
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(
    config: RollgateModuleConfig,
  ): ModuleWithProviders<RollgateModule> {
    return {
      ngModule: RollgateModule,
      providers: [
        { provide: ROLLGATE_CONFIG, useValue: config },
        RollgateService,
      ],
    };
  }

  /**
   * Import in feature modules without reconfiguring.
   */
  static forChild(): ModuleWithProviders<RollgateModule> {
    return {
      ngModule: RollgateModule,
      providers: [],
    };
  }
}
