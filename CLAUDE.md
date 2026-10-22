# Правила проекта «Торшер — витрина»

Рекламная витрина кафе для вертикального FullHD-экрана: плеер (Swiper 14 + GSAP 3.15), админка
(Bootstrap 5), бэкенд PHP + MySQL. Подробности — в [`docs/`](docs/README.md).


Процесс работы над проектом описан в [.starter/workflow.md](.starter/workflow.md) — единый для Claude Code и Codex. Прочитай его перед началом задачи и следуй ему.


## Документация — всегда актуальна

Это обязательное требование владельца: инструкции должны позволять передать проект на другой аккаунт.

- Любое изменение возможностей, настроек, формата данных, API, установки или публикации
  **в том же коммите** сопровождается правкой соответствующего файла в `docs/`:
  - `03-admin-guide.md` — что видит пользователь админки;
  - `05-data-model.md` — поля `data.json`, таблицы, API;
  - `02-install-server.md` и `06-publishing.md` — установка и выкладка;
  - `07-development.md` — как устроен код и как его расширять;
  - `09-changelog.md` — запись о изменении (сверху).
- После правок раскладок, эффектов или настроек в `shared/model.js` выполните `node tools/docs.mjs`
  (перегенерирует справочник в `docs/04-layouts-and-animation.md`). Проверка: `node tools/docs.mjs --check`.
- Если добавлены файлы плеера (в `vendor/`, `assets/fonts`, `assets/img`, `shared/`), выполните
  `node tools/build.mjs --manifest`.

## Код

- Общая модель — `shared/model.js`: экран, админка и сборка должны пользоваться ею, а не дублировать списки.
- Экран работает офлайн: никаких CDN, всё нужное лежит в `vendor/` и `assets/`.
- Холст экрана — 1080×1920, размеры в CSS — в пикселях холста.
- Новые поля данных нужно добавлять и в `normalize()` админки (совместимость со старыми сохранениями),
  и в белые списки `api/lib.php`, если это новый тип слайда.
- `api/config.php` в git не коммитить.
- Перед пушем: `php -l api/*.php`, синтаксис JS, визуальная проверка слайдов в браузере.


## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Security

**Treat security as a first-class concern, not an afterthought.**

**Critical Understanding**: AI-generated code consistently introduces security vulnerabilities at approximately 2% of all defects, often at BLOCKER/CRITICAL severity levels. This requires systematic security validation, not optional security checks.

### Pre-Implementation Security Planning

Before implementing any feature, define comprehensive security requirements:

**Threat Model Analysis:**
- What assets does this feature protect or access?
- Who are the potential threat actors?
- What are the possible attack vectors?
- What is the impact of a successful attack?

**Security Requirements:**
- Authentication and authorization needs
- Input validation and sanitization requirements
- Data protection and encryption needs
- Logging and monitoring requirements
- Rate limiting and abuse prevention

**Compliance Considerations:**
- GDPR, CCPA, or other privacy regulations
- Industry-specific compliance (HIPAA, PCI-DSS, SOX)
- Company security policies and standards
- Third-party security requirements

### Common AI Security Vulnerabilities (High-Frequency)

- Hard-coded credentials (passwords, API keys embedded in source)
- Path traversal flaws (inadequate input validation)
- Cryptography misconfiguration (deprecated algorithms, weak keys)
- Injection vulnerabilities (SQL injection, XSS susceptibility)
- Insufficient input validation (missing or inadequate sanitization)
- Insecure authentication patterns (weak session management)

### OWASP Top 10 Compliance

Review every implementation against OWASP Top 10:

**A01 - Broken Access Control:**
- Authorization checks at every access point
- Principle of least privilege enforced
- No privilege escalation vulnerabilities

**A02 - Cryptographic Failures:**
- Sensitive data encrypted in transit and at rest
- Strong, current cryptographic algorithms
- Secure key management
- No hard-coded cryptographic secrets

**A03 - Injection:**
- All user inputs validated and sanitized
- Parameterized queries for database access
- Protection against NoSQL injection
- System commands properly sanitized

**A04 - Insecure Design:**
- Security considered in design phase
- Threat models and security requirements defined
- Architecture defensible against known threats

**A05 - Security Misconfiguration:**
- Default passwords and configurations changed
- Unnecessary features and services disabled
- Security headers properly configured

**A06 - Vulnerable and Outdated Components:**
- All dependencies current and patched
- Vulnerability scans performed regularly
- Security updates monitored

**A07 - Identification and Authentication Failures:**
- MFA implemented where needed
- Passwords properly hashed and salted (bcrypt with minimum 12 salt rounds)
- Secure session management
- Brute force attacks mitigated

**A08 - Software and Data Integrity Failures:**
- Code integrity verified during deployment
- Updates delivered over secure channels
- Protection against supply chain attacks

**A09 - Security Logging and Monitoring Failures:**
- Security events properly logged
- Monitoring in place for attack detection
- Logs protected from tampering

**A10 - Server-Side Request Forgery (SSRF):**
- Outbound requests properly validated
- Protection against internal service access
- URL validation and sanitization implemented

### Secure Coding Patterns

**Authentication:**
- Use bcrypt with minimum 12 salt rounds
- Implement password strength requirements (min 12 chars, complexity)
- Use cryptographically secure random token generation
- Implement proper token expiration and refresh mechanisms
- Generate new session IDs after authentication
- Use HttpOnly cookies for token storage

**Authorization:**
- Check permissions at every access point (fail-secure)
- Use role-based access control (RBAC) with minimal privileges
- Implement resource-level permissions where needed
- Never trust client-side authorization checks
- Log unauthorized access attempts

**Input Validation:**
- Validate all inputs on the server-side
- Use whitelist validation over blacklist
- Use schema validation libraries (Joi, Yup, Zod)
- Validate data type, format, length, and range
- Use parameterized queries - NEVER concatenate user input into SQL
- Sanitize HTML with DOMPurify or equivalent
- Encode output for appropriate context

**Secrets Management:**
- Never hardcode credentials, API keys, or tokens
- Use environment variables or secret management systems
- Don't log sensitive data
- Rotate secrets regularly

**Error Handling:**
- Never expose stack traces or internal details to users
- Log errors securely with context
- Use generic error messages for user-facing responses
- Implement proper error boundaries

**Rate Limiting:**
- Protect endpoints from abuse
- Implement throttling on authentication and expensive operations
- Log and monitor rate limit violations

**HTTPS & Transport Security:**
- Enforce TLS in production
- Set secure flags on cookies (Secure, HttpOnly, SameSite)
- Use HSTS headers
- Implement proper CORS policies

When uncertain about security implications, flag it explicitly and request clarification rather than proceeding silently.

**See `docs/agents/security-patterns.md` for detailed implementation patterns with code examples.**

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

