# Security policy

## Supported versions

These packages are pre-1.0. Fixes go onto the latest minor release only, and the version pair is released together.

| Version | Supported |
| --- | --- |
| 0.1.x | yes |
| older | no |

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/st1lson/glitch-js/security/advisories/new). Please do not open a public issue for something exploitable.

Include the package and version, what an attacker can achieve, and the smallest reproduction you have. You should get a first response within a week.

If the problem is in the Glitch server rather than these packages, report it at [st1lson/glitch](https://github.com/st1lson/glitch/security) instead.

## Threat model

These packages are test tooling. They are a development dependency, never shipped to production, and they talk to a Glitch server that is expected to be local or on a trusted CI network.

That shapes what counts as a vulnerability here.

**In scope.** Anything that lets a dependency or a malicious tarball run code in a developer's or CI environment through these packages. A credential leak, most obviously the control API bearer token, into logs, traces, Playwright reports or attachments. A path traversal or command injection reachable from user-supplied configuration such as a scenario name or a profile name.

**Out of scope.** The Glitch server's own control API being unauthenticated on loopback: that is the server's documented default, and the packages simply speak the protocol. Chaos injection breaking an application under test, which is the entire purpose. Denial of service against a Glitch server you control.

## Supply chain

Releases are published from a tagged commit through a GitHub Actions workflow with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so every tarball on npm carries a verifiable link back to the source and the run that built it. Verify one with:

```bash
npm audit signatures
```

The published packages have no runtime dependencies beyond `glitch-core`, which itself has none. Playwright is a peer dependency, so it comes from your own lockfile rather than ours.
