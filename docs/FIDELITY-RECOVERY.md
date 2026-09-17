# Compiler fidelity recovery

The saved three-commit implementation from the interrupted session is preserved on
`recovery/compiler-responsive-native-saved`. The original commit identities were
`2b74ad30971fde0e0cd69d123b0fb7e9a3bab0c8`,
`0267df8b4d37eb755b02c72a6b286750b3abda3e`, and
`eb3b35dea184e6b6e9832e677b2ee5ad9a819de4`.

The uploaded mbox has SHA-256
`73c40eedbb4096262aeb42a125b90634da9e915978b9e674a651d0f02bf0ac8c`.
The historical branch reconstructs those source changes against their original
`dc89d1b` base. Its original CI configuration is retained as historical source; it is
not the current qualification pipeline and must not replace the newer one.

By recovery time, main already contained PR #20 (`56e6afba`) with a different CSS
implementation and actual native qualification fixes. Reapplying the saved combined
patch over that commit would revert those fixes. Reconciliation therefore preserves
both histories and integrates missing features on top of the newer implementation:

| Saved area                                                                     | Reconciliation                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Conditional CSS, selector matching, external stylesheets and length evaluation | Keep the newer compiler environment/selector/CSS/resource modules from #20.                                                       |
| CLI and Studio environment/resource UI                                         | Keep #20's confined project stylesheet loader and existing environment controls.                                                  |
| Native WPF/Avalonia harness                                                    | Keep the executed #20 projects under `tests/native/`, not the unqualified historical parallel harness.                            |
| Password-safe live capture                                                     | Restore default redaction before source metadata; add boolean opt-in, round-trip regressions and native masked-control fixtures.  |
| Named responsive profiles                                                      | Restore `compileResponsiveVariants`, validate the whole batch before callbacks and synchronize profile viewport/media dimensions. |
| Observer setup and lifecycle                                                   | Integrate transactional setup, additive media listeners, stylesheet-load/ancestor-scroll recapture and disposal tests.            |
| Compiler Fidelity Lab                                                          | Recover the authored example, adapt it to current result metadata and lifecycle, and add HTTP/browser coverage.                   |
| Opt-in native panel padding/gap lowering                                       | Preserved in the historical branch for separate integration and native qualification.                                             |

Recovery does not publish npm packages or bump versions. Archived source and tests
are not evidence of passing qualification; use the checks on each integration PR.
