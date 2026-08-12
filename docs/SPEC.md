# BrowserMesh

## Technical Specification

Version: 0.1
Status: Initial MVP specification

---

# 1. Product definition

BrowserMesh — open-source runtime для параллельного управления несколькими независимыми browser sessions AI-агентами.

Система должна позволять нескольким AI agents одновременно использовать браузер, не вмешиваясь в состояние друг друга.

BrowserMesh не является LLM framework.

BrowserMesh не является форком Playwright.

BrowserMesh не является browser GUI.

BrowserMesh предоставляет инфраструктурный runtime между AI agent и browser automation engine.

Основной первый integration protocol — MCP.

---

# 2. Главная проблема

Обычная browser automation часто основывается на неявном понятии:

`current browser / current page`.

Для single-agent automation это приемлемо.

Для multi-agent environment это создаёт:

* shared browser state;
* race conditions;
* переключение вкладок другим agent;
* смешивание cookies;
* смешивание authentication;
* неправильное управление lifecycle;
* потерю соответствия agent → session;
* невозможность безопасного parallel execution.

BrowserMesh должен устранить этот класс проблем.

---

# 3. Основная гарантия

Главный invariant системы:

> Browser actions внутри одной BrowserSession логически изолированы от browser actions других BrowserSessions.

Session A не должна иметь возможности случайно получить:

* cookies session B;
* localStorage session B;
* pages session B;
* page references session B;
* текущий URL session B;
* screenshots session B;
* DOM snapshot session B.

---

# 4. MVP

Первый MVP должен доказать:

`Agent/Client A → Session A`

и одновременно:

`Agent/Client B → Session B`

могут выполнять browser operations параллельно без пересечения состояния.

MVP должен работать локально.

---

# 5. Technology baseline

Основной язык:

TypeScript.

Runtime:

Node.js.

Browser automation engine:

Playwright.

Initial browser:

Chromium.

Initial external protocol:

Model Context Protocol.

Validation:

schema-based runtime input validation.

Testing:

unit + integration + end-to-end.

---

# 6. Architecture

Использовать modular-monolith architecture.

Основные слои:

## Domain

Содержит бизнес-модель BrowserMesh.

Не зависит от:

* Playwright;
* MCP;
* filesystem implementation;
* Node transport implementation.

## Application

Содержит use-cases и orchestration.

Например:

* CreateSession;
* CloseSession;
* ListSessions;
* Navigate;
* CreatePage;
* ClosePage;
* SnapshotPage;
* ExecutePageAction.

## Runtime

Управляет:

* active sessions;
* concurrency;
* lifecycle;
* action serialization;
* runtime references.

## Adapters

Реализуют внешние interfaces:

* Playwright browser engine;
* MCP;
* local persistence.

## Infrastructure

Общие технические компоненты:

* config;
* logging;
* IDs;
* time;
* shutdown.

---

# 7. Dependency direction

Разрешается:

`adapters → application → domain`

`runtime → domain`

`infrastructure → declared interfaces`

Запрещается:

`domain → Playwright`

`domain → MCP`

`application → MCP`

`application → concrete Playwright implementation`

MCP adapter вызывает application use-cases.

Playwright adapter реализует browser engine port.

---

# 8. Browser Engine abstraction

BrowserMesh должен иметь abstraction для browser engine.

Application layer не должен знать:

* `Browser`;
* `BrowserContext`;
* `Page`;
* Playwright locator implementation.

Первая implementation использует Playwright.

Архитектура должна потенциально позволять добавить другие browser engines.

---

# 9. Browser lifecycle

Runtime должен управлять browser process централизованно.

Для MVP допускается:

`1 Browser process → N BrowserContexts`.

Browser process должен запускаться lazy либо при старте runtime согласно выбранному и документированному решению.

При shutdown:

1. прекратить принимать новые операции;
2. корректно завершить pending operations;
3. закрыть contexts;
4. закрыть browser;
5. завершить process.

Resource leaks недопустимы.

---

# 10. BrowserSession

Каждая session имеет:

* unique id;
* optional human-readable name;
* status;
* createdAt;
* lastActivityAt;
* optional metadata;
* persistence settings.

Минимальные statuses:

* creating;
* ready;
* closing;
* closed;
* failed.

---

# 11. Session ID

Session ID:

* уникален внутри runtime;
* immutable;
* используется во всех browser operations;
* не зависит от page URL;
* не зависит от MCP connection;
* не зависит от agent connection.

Human-readable name не является primary identity.

---

# 12. Isolation

Каждая BrowserSession MVP соответствует отдельному Playwright BrowserContext.

Нельзя использовать один BrowserContext одновременно как несколько независимых sessions.

---

# 13. No global active session

В проекте запрещены концепции:

* global current session;
* global active page;
* global current page;
* global current tab.

Каждый operation contract должен однозначно определять target session.

---

# 14. Pages

Одна BrowserSession может содержать несколько pages.

Page получает собственный unique pageId.

Session должна иметь возможность:

* list pages;
* create page;
* close page;
* выбрать page явно через pageId.

Допускается initial page, создаваемая автоматически.

---

# 15. Default page semantics

Если MVP временно предоставляет convenience operation без pageId:

* поведение должно быть deterministic;
* правило выбора default page должно быть явно задокументировано;
* API должен позволять перейти к explicit pageId.

Предпочтение отдаётся explicit addressing.

---

# 16. Concurrency

Разные sessions могут выполнять операции одновременно.

Пример:

`session-A.navigate()`

и:

`session-B.click()`

не должны блокировать друг друга глобальным mutex.

---

# 17. Per-session action queue

Для одной session browser-changing operations должны сериализоваться либо управляться equivalent concurrency primitive.

Цель:

исключить логически несовместимые конкурентные действия над одной session.

Не использовать один глобальный application-wide lock.

---

# 18. Operation IDs

Каждая browser operation должна иметь operationId.

Он используется для:

* logging;
* correlation;
* future tracing;
* debugging;
* event history.

---

# 19. Timeouts

Все potentially blocking browser operations должны поддерживать ограниченное время ожидания.

Не допускаются бесконечные hangs.

Timeout behavior должен быть:

* configurable;
* predictable;
* возвращать structured error.

---

# 20. Errors

Ошибки должны быть типизированы на уровне приложения.

Минимальные error categories:

* SESSION_NOT_FOUND;
* SESSION_NOT_READY;
* PAGE_NOT_FOUND;
* SESSION_CLOSED;
* INVALID_ARGUMENT;
* OPERATION_TIMEOUT;
* NAVIGATION_FAILED;
* ELEMENT_NOT_FOUND;
* BROWSER_ERROR;
* INTERNAL_ERROR.

Позже:

* SESSION_OWNED_BY_ANOTHER_AGENT;
* AGENT_NOT_FOUND;
* MESSAGE_TARGET_NOT_FOUND.

Не отдавать наружу только raw Playwright stack как публичный контракт.

Underlying cause может сохраняться в logs.

---

# 21. Initial browser capabilities

MVP должен поддерживать:

## Session

* create;
* list;
* get;
* close.

## Page

* create;
* list;
* close.

## Navigation

* navigate;
* get current URL;
* back;
* forward;
* reload.

## Interaction

* click;
* fill;
* type when materially necessary;
* press key;
* select option where возможно.

## Inspection

* page title;
* accessibility-oriented snapshot или эквивалентное структурированное представление;
* visible text/query operations where necessary.

## Capture

* screenshot.

Не нужно в первой версии реализовывать весь Playwright API.

---

# 22. Locator strategy

BrowserMesh не должен строиться исключительно вокруг brittle CSS selectors.

API должен допускать semantic locator strategy:

* role;
* text;
* label;
* placeholder;
* test id;
* CSS only when required.

Details могут эволюционировать, но protocol должен быть расширяемым.

---

# 23. MCP layer

MCP является adapter.

MCP tool handlers:

* валидируют input;
* вызывают application services;
* преобразуют application result в MCP result;
* преобразуют application errors в понятное tool response.

Они НЕ должны непосредственно выполнять Playwright operations.

---

# 24. Initial MCP transport

Initial local MVP:

stdio.

Architecture должна позволить позже добавить:

Streamable HTTP.

Business logic не должна зависеть от transport.

---

# 25. MCP tools

Минимальный набор:

`browser_session_create`

`browser_session_list`

`browser_session_get`

`browser_session_close`

`browser_page_create`

`browser_page_list`

`browser_page_close`

`browser_navigate`

`browser_back`

`browser_forward`

`browser_reload`

`browser_get_url`

`browser_get_title`

`browser_snapshot`

`browser_click`

`browser_fill`

`browser_press`

`browser_screenshot`

Naming может корректироваться при реализации, если сохранена последовательность и читаемость API.

---

# 26. Explicit session addressing

Все browser-related MCP tools обязаны получать:

`sessionId`.

Page-specific operations также получают:

`pageId`

либо используют ясно определённый default page mechanism.

---

# 27. Session persistence

BrowserMesh должен уметь сохранять browser authentication/storage state.

Минимальные операции позднего MVP:

* save session state;
* create session from saved state;
* list saved states;
* delete saved state.

---

# 28. Persistent state security

Authentication state может содержать чувствительные credentials.

Поэтому:

* storage directory должна игнорироваться Git;
* state files нельзя случайно commit'ить;
* documentation должна предупреждать о чувствительности файлов;
* application logs не должны печатать cookies/tokens.

---

# 29. Persistence model

Не пытаться сериализовать live BrowserContext.

Persistence означает:

сохранить поддерживаемое browser storage/auth state и создать новый context из него после восстановления.

---

# 30. Local storage

Для первой версии достаточно filesystem adapter.

Например internal data directory:

`.browsermesh/`

Но структура хранения является implementation detail.

Domain layer не должен знать filesystem paths.

---

# 31. Agents — Phase 2

После стабильного multi-session runtime добавить Agent entity.

Agent:

* id;
* name;
* status;
* createdAt;
* metadata.

---

# 32. Agent/session assignment

Agent может получить BrowserSession.

Не следует жёстко объединять Agent и BrowserSession в одну сущность.

Причина:

в будущем agent может:

* не иметь browser;
* иметь несколько sessions;
* передать session другому agent;
* получить временную session.

---

# 33. Session ownership

Добавить ownership/lease model.

Session может быть:

* unowned;
* owned by agent.

Browser operation от другого agent должна отклоняться либо требовать explicit handoff.

---

# 34. Lease

В будущем ownership должен использовать lease semantics, чтобы погибший agent не блокировал session навсегда.

Lease может иметь:

* ownerAgentId;
* acquiredAt;
* expiresAt;
* generation/version.

Для первого Agent MVP можно начать проще, но interface должен позволить evolution.

---

# 35. Agent registry

Необходимые operations:

* create agent;
* get agent;
* list agents;
* remove agent;
* assign session;
* release session.

---

# 36. Messaging

Agents должны иметь возможность общаться.

Message entity:

* id;
* fromAgentId;
* toAgentId;
* type;
* payload;
* createdAt;
* correlationId;
* optional replyTo.

---

# 37. Message types

Первоначальные:

* message;
* request;
* response;
* event;
* handoff.

---

# 38. Agent mailbox

Каждый Agent получает mailbox.

Operations:

* send;
* receive/list unread;
* acknowledge;
* optionally reply.

Первоначальная implementation:

in-memory.

---

# 39. Message ordering

Message ordering внутри одного recipient mailbox должно быть deterministic.

Не требуется глобальный ordering всех сообщений системы.

---

# 40. Event system

Runtime должен иметь lightweight internal event abstraction.

Не использовать external broker для MVP.

Events могут включать:

* session.created;
* session.closed;
* page.created;
* page.closed;
* navigation.started;
* navigation.completed;
* operation.started;
* operation.completed;
* operation.failed;
* agent.created;
* agent.assigned;
* message.sent.

---

# 41. Observability

Первоначально:

structured logs.

Каждая операция должна позволять связать:

* operationId;
* sessionId;
* pageId;
* agentId where available.

Не логировать:

* passwords;
* auth tokens;
* cookies;
* raw secrets.

---

# 42. Future tracing

Architecture должна позволить позже подключить OpenTelemetry.

OpenTelemetry не является обязательным для первого milestone.

---

# 43. Configuration

Configuration должна поддерживать:

* browser engine;
* headless/headed mode;
* default timeout;
* data directory;
* log level;
* max sessions;
* persistence enable/disable.

Config должен иметь validation.

---

# 44. Environment

Не использовать прямой `process.env` хаотически по всему проекту.

Environment configuration читается централизованно.

---

# 45. Limits

Runtime должен иметь configurable:

* maximum sessions;
* maximum pages per session;
* operation timeout.

Это защищает от случайного resource exhaustion.

---

# 46. Session cleanup

При закрытии session должны закрываться:

* pages;
* BrowserContext;
* associated runtime handles;
* queues;
* leases.

Повторный close должен иметь predictable idempotent behavior либо documented error behavior.

---

# 47. Crash behavior

В MVP нет требования восстанавливать live operations после process crash.

Persistent saved authentication state должен оставаться пригодным к восстановлению.

---

# 48. Shutdown

Обработать process shutdown signals.

Graceful shutdown должен:

1. остановить новые requests;
2. завершить или корректно отменить активные операции;
3. закрыть sessions;
4. закрыть browser engine;
5. завершить transports.

---

# 49. Testing strategy

Проект обязан иметь:

* unit tests;
* integration tests;
* end-to-end tests.

---

# 50. Unit tests

Тестировать отдельно:

* session registry;
* lifecycle transitions;
* queues/locks;
* ownership rules;
* error mapping;
* validation.

Unit tests не должны запускать реальный Chromium там, где это не требуется.

---

# 51. Integration tests

Использовать реальный Playwright там, где необходимо проверить:

* BrowserContext isolation;
* page lifecycle;
* storage state;
* concurrent sessions.

---

# 52. Critical isolation test

Обязательный тест:

Создать:

`session-a`

`session-b`.

Установить разные browser states.

Проверить:

state A недоступен в B.

state B недоступен в A.

---

# 53. Critical concurrency test

Одновременно выполнить browser operations:

Session A → page A.

Session B → page B.

Убедиться:

operations не воздействуют на противоположную session.

---

# 54. Same-session concurrency test

Запустить конфликтующие operations над одной session.

Убедиться, что per-session synchronization предотвращает nondeterministic corruption.

---

# 55. Persistence test

1. Создать session.
2. Установить state.
3. Сохранить state.
4. Закрыть session.
5. Создать новую session из сохранённого state.
6. Проверить восстановление.

---

# 56. MCP integration tests

Проверить:

* server starts;
* tools discoverable;
* tool input validation;
* create session;
* navigate;
* inspect;
* close session;
* structured error responses.

---

# 57. Test web application

Для deterministic browser e2e tests предпочтительно использовать маленький локальный test web server вместо зависимости от Google/GitHub/сторонних сайтов.

Он должен позволить проверять:

* cookies;
* local storage;
* forms;
* buttons;
* navigation;
* separate roles.

---

# 58. Code quality

Обязателен strict TypeScript.

Избегать:

* `any`;
* unsafe casts;
* hidden global mutable state;
* empty catches;
* swallowed promises;
* fire-and-forget без обработки errors.

---

# 59. Formatting/lint

Проект должен иметь автоматические:

* formatting;
* lint;
* typecheck.

Выбранные tools должны быть документированы.

---

# 60. Public contracts

Public interfaces должны быть стабильнее внутренних implementation details.

Не отдавать Playwright objects наружу.

Не отдавать internal Map references наружу.

---

# 61. Documentation

Обязательные документы:

`README.md`

`docs/architecture.md`

`docs/development.md`

`docs/SPEC.md`

`docs/decisions/`

---

# 62. ADR

Создавать Architecture Decision Record для значимых решений.

Например:

* BrowserContext-per-session;
* modular monolith;
* per-session queue;
* persistence strategy;
* MCP transport strategy.

---

# 63. README

README должен содержать:

* что такое BrowserMesh;
* какую проблему решает;
* minimal architecture;
* installation;
* local usage;
* MCP configuration example;
* supported tools;
* limitations;
* development commands.

---

# 64. Security

Browser automation — privileged capability.

Поэтому предусмотреть:

* no secrets in logs;
* safe state storage;
* input validation;
* no arbitrary local filesystem read through browser tools;
* no implicit arbitrary command execution;
* clear trust boundaries.

---

# 65. No shell tool

BrowserMesh browser API не должен автоматически превращаться в general-purpose remote shell.

Не добавлять arbitrary shell execution в browser MCP server.

---

# 66. Screenshots

Screenshots должны быть привязаны к:

* sessionId;
* pageId;
* operationId.

Filesystem path handling должен быть безопасным.

Не разрешать uncontrolled arbitrary overwrite paths.

---

# 67. Browser downloads

Downloads не обязательны для initial MVP.

Если добавляются позже, требуется отдельная sandboxed download policy.

---

# 68. Network policy

Initial local MVP может использовать обычную network configuration пользователя.

Но architecture должна позволять позже добавить:

* allowed hosts;
* blocked hosts;
* proxy;
* network interception.

---

# 69. Multi-browser

MVP:

Chromium.

Не тратить время на одинаковую поддержку:

* Firefox;
* WebKit.

Добавить их после стабилизации engine abstraction.

---

# 70. Headless/headed

Оба режима должны быть возможны через configuration.

Development удобно поддерживать headed mode для debugging.

---

# 71. CLI

Отдельный богатый CLI не нужен на первом этапе.

Допустим минимальный runtime start command.

Полноценный:

`browsermesh sessions`

`browsermesh agents`

не является MVP.

---

# 72. Web UI

Не реализовывать в MVP.

Dashboard появится только после доказательства runtime architecture.

---

# 73. Database

Не добавлять PostgreSQL в MVP.

In-memory runtime state + filesystem persistence достаточны.

---

# 74. Redis

Не добавлять Redis до появления distributed workers.

---

# 75. Docker

Docker не является требованием initial implementation.

Сначала runtime должен стабильно запускаться локально.

Dockerization — отдельный будущий milestone.

---

# 76. Distributed architecture

Future version может разделить:

* gateway;
* coordinator;
* browser workers;
* state store;
* message broker.

Но public domain concepts текущего проекта должны позволять это сделать без полной переписи.

---

# 77. Phases

## Phase 0 — Foundation

Создать:

* TypeScript project;
* strict configuration;
* lint;
* formatting;
* tests;
* directory architecture;
* config;
* logging;
* basic docs;
* CI-ready scripts.

No browser functionality required beyond smoke preparation.

---

## Phase 1 — Browser Engine

Реализовать:

* browser engine abstraction;
* Playwright adapter;
* browser start;
* browser stop;
* graceful shutdown.

Tests обязательны.

---

## Phase 2 — Multi-session Core

Реализовать:

* Session entity;
* registry;
* lifecycle;
* create;
* get;
* list;
* close;
* BrowserContext-per-session;
* resource cleanup.

Это первый ключевой milestone продукта.

---

## Phase 3 — Pages

Реализовать:

* page IDs;
* create;
* list;
* get;
* close;
* deterministic default page behavior if retained.

---

## Phase 4 — Basic Browser Actions

Реализовать:

* navigate;
* back;
* forward;
* reload;
* get URL;
* title;
* click;
* fill;
* press;
* snapshot;
* screenshot.

---

## Phase 5 — Concurrency

Реализовать:

* per-session action serialization;
* parallel execution across sessions;
* operation IDs;
* timeouts;
* race-condition tests.

После этого можно считать доказанной ключевую техническую гипотезу BrowserMesh.

---

## Phase 6 — MCP

Реализовать:

* MCP adapter;
* stdio transport;
* tool schemas;
* mapping errors;
* MCP integration tests.

После Phase 6 проект должен уже подключаться к MCP-compatible coding agent/client.

---

## Phase 7 — Persistence

Реализовать:

* save storage/auth state;
* restore session;
* list states;
* remove state;
* filesystem storage;
* secret-safe logging.

---

## Phase 8 — Agents

Реализовать:

* Agent entity;
* Agent registry;
* session assignment;
* ownership;
* release/handoff.

---

## Phase 9 — Messaging

Реализовать:

* mailbox;
* send;
* receive;
* request;
* response;
* correlation;
* handoff event.

---

## Phase 10 — Multi-agent demo

Создать deterministic demonstration.

Scenario:

Agent Buyer:

1. получает buyer session;
2. создаёт объект/заказ в test application;
3. отправляет сообщение Seller.

Agent Seller:

1. имеет отдельную seller session;
2. получает сообщение;
3. находит созданный объект;
4. выполняет действие;
5. отвечает Buyer.

Buyer:

1. получает ответ;
2. проверяет изменение состояния.

Две browser sessions должны оставаться полностью изолированными.

---

# 78. MVP acceptance criteria

MVP считается успешным, если можно одновременно создать:

`buyer`

`seller`

и выполнить независимые действия.

Например:

Buyer:

`session buyer → page → site A`

Seller:

`session seller → page → site B`

После параллельного выполнения:

* URLs правильные;
* cookies не смешались;
* storage не смешался;
* pages не смешались;
* никакой global active page не использован.

---

# 79. MCP acceptance criteria

Внешний MCP client должен уметь:

1. создать session;
2. узнать sessionId;
3. открыть page;
4. navigate;
5. получить snapshot/title/url;
6. выполнить interaction;
7. создать вторую session;
8. работать с обеими независимо;
9. закрыть их.

---

# 80. Agent acceptance criteria

После реализации Agent layer:

* Agent A владеет session A;
* Agent B владеет session B;
* Agent B не может незаметно вмешаться в session A;
* ownership можно безопасно передать;
* agents могут отправлять сообщения друг другу.

---

# 81. Non-goals for v0.1

Не являются целями:

* autonomous LLM reasoning;
* собственная LLM;
* prompt framework;
* visual browser editor;
* full Playwright API;
* Selenium replacement;
* browser cloud;
* Kubernetes orchestration;
* distributed execution;
* SaaS billing;
* user management;
* production multi-tenant cloud.

---

# 82. Product philosophy

BrowserMesh должен следовать принципам:

Explicit over implicit.

Isolation by default.

Concurrency where safe.

Serialization where required.

Small core.

Adapters around the core.

No global browser state.

No unnecessary infrastructure.

Test real concurrency.

Fail visibly.

Preserve debuggability.

Design for multi-agent usage from the beginning.

---

# 83. Definition of Done

Для каждой phase:

* implementation завершена;
* TypeScript compile/typecheck проходит;
* lint проходит;
* tests проходят;
* новые contracts покрыты tests;
* resources закрываются;
* errors обработаны;
* docs обновлены;
* архитектурные boundaries не нарушены.

---

# 84. Final v0.1 result

Конечный результат первой версии должен выглядеть концептуально так:

`MCP Client A`
→ `BrowserMesh`
→ `Session A`
→ `BrowserContext A`

параллельно:

`MCP Client B`
→ `BrowserMesh`
→ `Session B`
→ `BrowserContext B`

и затем:

`Agent A ↔ Message Bus ↔ Agent B`

при гарантированной browser-session isolation.

Это является фундаментом BrowserMesh.
