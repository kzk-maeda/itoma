# Demo-only changes

All screen, fixture, evidence and demo-specific test changes belong under demo/.
Import product components/types/theme read-only; never add product imports of demo code.
Do not modify src/, modules/, packages/, extensions/, assets/, root app config or dependencies for a demo.
If a reusable product API or build capability is needed, propose a separate foundation PR.
Do not alias/patch imported product modules to demo implementations. Mock data belongs to demo-owned state.
This rule does not itself establish a CI boundary; report diff audits and remaining enforcement separately.
