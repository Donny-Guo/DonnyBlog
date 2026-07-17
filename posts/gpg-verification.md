---
title: "Verifying Open Source Packages: From Checksums to GPG Signatures"
date: "2026-07-17 10:45:00"
categories:
  - Security
tags:
  - GPG
  - Security
  - DevOps
thumbnail: "/images/gpg-verification.jpg"
---

When downloading binaries or source archives from open source projects, the common practice is to "check the hash." While this ensures the file wasn't corrupted during transit, it does nothing to prove the file was actually produced by the legitimate maintainer.

For security-focused users and developers, verification should be a pipeline: moving from **Integrity** (Has the file changed?) to **Authenticity** (Who signed this?).

## 1. The Baseline: Integrity via Checksums

Checksums (hashes) are the first line of defense. They detect accidental corruption or naive tampering.

### Common Commands

Depending on your OS, you'll use different utilities to generate the hash of the downloaded file.

**Linux (GNU Coreutils):**

```bash
sha256sum package.tar.gz
```

**macOS:**

```bash
shasum -a 256 package.tar.gz
```

### The Flaw

If an attacker compromises the download server, they can replace both the binary AND the `sha256sum.txt` file. The hashes will match, but you are verifying a malicious file. This is why cryptographic signatures are required.

---

## 2. The Gold Standard: Authenticity via GPG

A GPG signature proves that the holder of a specific private key signed the file. Even if the server is compromised, the attacker cannot forge a signature without the private key.

### Step-by-Step Verification

#### A. Acquire the Public Key

You cannot verify a signature without the maintainer's public key. **Warning:** Downloading a key from the same server as the binary is a security risk. The most robust method is downloading a key file via a separate trusted channel and importing it.

```bash
# Import from a key file (Recommended)
gpg --import developer_key.asc

# Import from a keyserver (Fallback)
gpg --keyserver hkps://keys.openpgp.org --recv-keys <KEY_ID>
```

#### B. Verify the Signature

Packages usually come with a detached signature file (e.g., `package.tar.gz.asc` for ASCII-armored text or `package.tar.gz.sig` for binary).

```bash
# If the signature file follows the naming convention, GPG often finds the data file automatically
gpg --verify package.tar.gz.asc

# Otherwise, explicitly provide both
gpg --verify package.tar.gz.asc package.tar.gz
```

### Interpreting the Result

You will likely see output like this:

```text
gpg: Good signature from "Developer Name <email@example.com>"
gpg: WARNING: This key is not certified with a trusted signature!
```

**Critical Warning:**
A "Good signature" only means that the file was signed by the private key corresponding to the public key you imported. If you imported a malicious key that _claimed_ to be the developer's, the signature will still be "Good."

**A "Good signature" is ONLY sufficient if you have verified the key's fingerprint out-of-band (see Section 3).**

---

## 3. The Trust Gap: Finding the Key

The hardest part of PGP is "Out-of-Band" verification. To be truly secure, you should verify the key's fingerprint.

1. Find the fingerprint on the official project website or the developer's trusted profile.
2. Compare it to the imported key:

```bash
gpg --fingerprint <KEY_ID>
```

If the fingerprints match, the key is authentic.

---

## 4. Real-World Examples

### Example 1: LibreWolf (bsys6)

LibreWolf provides binaries with specific versioning (e.g., `librewolf-152.0.6-1-linux-x86_64-package.tar.xz`).

**Workflow:**

1. Download the binary and the corresponding signature file.
2. Get the public key from the official LibreWolf security channel.
3. Run the verification:

```bash
# 1. Check hash first (Integrity)
sha256sum librewolf-152.0.6-1-linux-x86_64-package.tar.xz
# Compare with the SHA256 listed on repo.librewolf.net (per-file table, no separate sums file)

# 2. Import the developer's key
gpg --keyserver hkps://keys.openpgp.org --recv-keys <LibreWolf_Dev_Key_ID>

# 3. Verify authenticity (Authenticity)
# LibreWolf uses .sig for binary signatures
gpg --verify librewolf-152.0.6-1-linux-x86_64-package.tar.xz.sig librewolf-152.0.6-1-linux-x86_64-package.tar.xz
```

### Example 2: Restic

Restic provides signed releases to ensure the backup tool itself hasn't been tampered with.

**Workflow:**

1. Download the binary (e.g., `restic_0.19.1_linux_amd64.bz2`), `SHA256SUMS`, and `SHA256SUMS.asc`.
2. Import the Restic maintainer's public key (Key ID: `91A6868BD3F7A907`).
3. Execute the verification:

```bash
# 1. Verify the hash file itself is signed by fd0 (Authenticity)
gpg --verify SHA256SUMS.asc SHA256SUMS

# 2. Check your binary's hash against the signed hash file (Integrity)
sha256sum restic_0.19.1_linux_amd64.bz2
# Compare with the hash listed in SHA256SUMS
```

Restic also signs its Git tags. You can verify the tag signature directly:

```bash
# Verify the annotated tag object itself (proves the commit is authored by fd0)
git tag -v v0.19.1
```

_Note: If the signature is valid, GPG will report "Good signature from fd0 (Alexander Neumann)". Always cross-reference the key ID (`91A6868BD3F7A907`) with Restic's official documentation to ensure you aren't verifying against a spoofed key._

---

## Developer's Quick Reference

| Goal                  | Command                                         | Note                                |
| :-------------------- | :---------------------------------------------- | :---------------------------------- |
| **Check SHA256**      | `sha256sum <file>`                              | macOS: `shasum -a 256`              |
| **Import Key**        | `gpg --import <file>` or `gpg --recv-keys <ID>` | Use `hkps://keys.openpgp.org`       |
| **Verify Sig**        | `gpg --verify <sig> [file]`                     | `.asc` (armored) or `.sig` (binary) |
| **Check Fingerprint** | `gpg --fingerprint <ID>`                        | Compare with official source        |
| **Export Public Key** | `gpg --export -a <ID>`                          | For sharing your own key            |
