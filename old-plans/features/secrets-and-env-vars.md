# Secrets and Env Vars

## Description

This feature defines how endpoint secrets and environment variables are stored, updated, decrypted, and injected during deploy. The design target is that a database leak alone does not compromise endpoint secret material. This design does not protect against an attacker who has gained equivalent authority to the decrypting control-plane process; at that point all encryption guarantees are defeated.

## Decisions

- _Scope and Ownership_
  - Secret and environment-variable lifecycle decisions are owned by this feature, not by `admin-api.md`.
  - Administration API remains the interface boundary for write and metadata-read operations, while cryptographic policy is defined here.
  - Secret lifecycle is a dedicated API/process surface separate from `/build` submission.
  - Secret sets may be shared across multiple endpoints; endpoint-unique secret sets remain supported.

- _Secret API Surface_
  - Secret API does not provide a read endpoint for secret values.
  - Supported operations are create, update, delete, and list.
  - List returns metadata only: secret-set UUID and the list of endpoints bound to that UUID.
  - Create and update responses return the secret-set UUID.
  - Delete response returns a boolean success value (`true` or `false`).

- _Encryption at Rest_
  - Endpoint secret data must be encrypted at rest.
  - To reduce partial-leak paths and simplify update semantics, secrets and vars are stored as one encrypted JSON object payload per secret set.
  - Plaintext secret values are never written to persistent storage.

- _Client-Side Encryption Model_
  - Client-side encryption is the preferred path: client requests a secret-set public key, encrypts locally, and sends ciphertext payloads.
  - Key exchange uses an X25519 public key generated for the secret set.
  - Payload encryption uses hybrid encryption: X25519 key agreement plus AES-256-GCM for content encryption.
  - Client submits encrypted payload plus the ephemeral public key used for the payload.

- _Server Key Storage and Wrapping_
  - A secret-set is an encrypted blob of all the secrets and vars for that set.
  - Secret-set public key may be stored in clear text.
  - Secret-set private key must be encrypted (wrapped) with a master key before storage.
  - Master key scope is limited to protecting stored secret-set private keys.
  - Master key storage location must be defined and separate from the database access path; the threat model holds only when these two require independent credentials and privilege escalation paths.

- _Deploy-Time Decryption and Injection_
  - Secrets must be decrypted before injection into `POST /deploy` payloads.
  - Decryption is in-memory only on the control-plane path preparing deploy content.
  - If required decrypt/injection steps fail for a bound secret set, the deploy attempt is failed and the caller receives a 5xx server error.
  - Missing secret key records are treated as records not present, and deploy continues without secret injection for that secret set.
  - Plaintext values must not appear in API responses and must not be persisted after deploy request construction.
  - Plaintext secret/env variables must be cleared from process memory immediately after a successful send of the deploy payload.

- _Update and Delete Behavior_
  - A secret/env update overwrites the active encrypted payload for the secret set.
  - Endpoint bindings reference a specific secret-set ID; no secret payload version history is retained.
  - Secret set updates trigger asynchronous recycle of active endpoint-bound HOT pods for all attached endpoints.
  - Secret set deletion is rejected while endpoint bindings exist.

- _Data Model_
  - Plan for SQL-backed storage with a secret-set table and an endpoint-secret binding table.
  - Endpoint-secret bindings are normalized by endpoint identity and secret-set UUID.

- _Network Controls_
  - Kubernetes Secrets and ConfigMaps are not used for tenant runtime delivery.

## Reasons for Decisions

- Secret and environment-variable lifecycle details are centralized in this feature file to keep key management, encryption, and deploy injection contracts consistent.
- Avoiding Kubernetes Secrets/ConfigMaps and mounted volumes reduces in-cluster secret and persistence surfaces.
- Strict ingress/egress policy with RFC1918 blocking is intended to reduce lateral movement and private network access risk.
- The encryption model is explicitly scoped to defending against database-only breaches. It does not claim to defend against an attacker with control-plane authority. Operators and auditors should treat a full control-plane compromise as a full secret disclosure event requiring customer notification and credential rotation at their external providers.

## To Plan

- _API and Validation Contract_
  - Define public-key retrieval API shape, key lifetime, and invalidation behavior.
  - Define secret-set create/update/delete/list and endpoint bind/rebind API contracts.
  - Define update semantics for full replacement of encrypted JSON object payloads.
  - Define key naming rules, size limits, payload size bounds, and deterministic redaction behavior for logs and events.
  - Define algorithm/version negotiation fields to support cryptographic upgrades without breaking clients.

- _Key Management and Rotation_
  - Define secret-set keypair rotation policy and compatibility window for old ciphertext.
  - Define master-key rotation and rewrap process for stored secret-set private keys.
  - Define storage and access boundary for master key material (HSM/KMS vs local secret store).

- _Operational Safety_
  - Define audit-event model for secret writes, deletes, decrypt attempts, and policy changes.

## Concerns

- _Threat Model Gaps_
  - Database leak resistance claim holds only when database access and master key access require separate credentials and independent privilege escalation paths; if both are reachable from the same compromise, the claim fails.
  - Client-side encryption preference is not enough if server also accepts plaintext writes without strict policy boundaries.
  - Full control-plane compromise defeats all encryption guarantees: an attacker with equivalent authority to the decrypting control-plane process can derive plaintext for all active secret sets regardless of key wrapping or storage separation.

- _Key and Crypto Risks_
  - Master key compromise exposes all wrapped secret-set private keys and enables bulk secret decryption; gaining the master key likely requires the same control-plane authority that defeats the encryption model entirely.
  - Secret-set key rotation can strand unreadable ciphertext unless compatibility and re-encryption strategy are explicit.
  - Missing algorithm/version metadata can cause silent decryption failures during client/server crypto upgrades.

- _Deploy and Runtime Risks_
  - Decrypting on deploy path can add latency and create cascading failures during burst scale-out.
  - In-memory plaintext handling can leak through logs, crash dumps, traces, or debug tooling without redaction and memory hygiene controls.
  - Treating missing key records as "not present" can silently mask data-loss, replication-lag, or accidental-delete events unless explicit detection and alerting are defined.
  - Hard-failing deploy on decryption/injection errors creates deterministic 5xx windows until key or ciphertext state is repaired.
  - Secret-set updates are asynchronous for attached endpoints, so mixed old/new secret material can be active until recycle completes.

- _Data Model Risks_
  - Encrypting all secrets and vars as one JSON blob increases blast radius for single-field updates and may increase write amplification.
  - Large payload blobs can exceed API/proxy limits and fail unpredictably without strict size bounds.

## Examples

- _Client Encrypt and Write_
  - Client calls secret-set key API, receives secret-set public key, encrypts local JSON payload with hybrid X25519 + AES-256-GCM, and submits ciphertext plus ephemeral public key. Server stores only encrypted payload and wrapped secret-set private key.

- _Secret Update_
  - Client updates a shared secret set by sending a replacement encrypted JSON payload. Server overwrites the active payload and emits endpoint-change events so attached endpoints recycle active pods in background.

- _Deploy Read and Inject_
  - Deploy path resolves endpoint-to-secret-set binding, loads secret-set keypair record and encrypted payload, unwraps secret-set private key using master key, derives shared secret with stored ephemeral public key, decrypts payload in memory, injects secrets/vars into deploy payload, and discards plaintext buffers after request assembly.

- _Secret Removal_
  - Client requests secret-set deletion; server rejects deletion when any endpoint binding exists, and accepts deletion only after all endpoint bindings are removed.
