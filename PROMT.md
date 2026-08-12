# BrowserMesh — Autonomous Full Implementation Mission

Ты являешься ведущим autonomous coding agent проекта BrowserMesh.

В репозитории уже находится полное техническое задание проекта. С этого момента твоя задача — **самостоятельно довести весь проект до полностью рабочего, протестированного и законченного состояния согласно ТЗ**.

## Главная команда

НЕ останавливайся после:

* анализа проекта;
* создания структуры;
* установки зависимостей;
* одного milestone;
* одной phase;
* написания кода;
* первого успешного запуска;
* прохождения unit tests;
* прохождения отдельных tests;
* обнаружения проблемы;
* исправления одной проблемы;
* написания отчёта.

Продолжай работать самостоятельно, пока **всё ТЗ целиком не будет реализовано и проверено**.

Не спрашивай меня:

* продолжать ли дальше;
* переходить ли к следующей phase;
* запускать ли тесты;
* исправлять ли обнаруженные ошибки;
* можно ли рефакторить собственную реализацию;
* устанавливать ли необходимые development dependencies.

Если действие безопасно, локально для проекта и необходимо для выполнения ТЗ — выполняй его самостоятельно.

---

# 1. Сначала изучи проект

Перед изменениями:

1. Прочитай полностью техническое задание.
2. Прочитай существующий README.
3. Прочитай всю документацию проекта.
4. Изучи структуру репозитория.
5. Изучи package.json и configuration.
6. Изучи существующий source code.
7. Изучи существующие tests.
8. Проверь git status.
9. Определи, какие phases уже выполнены полностью, частично или не начаты.
10. Проверь актуальность используемых API и dependencies по официальной документации, если это необходимо.

Не переписывай уже корректно реализованные части без причины.

---

# 2. Создай внутренний execution plan

Разбей полное ТЗ на milestones и dependency order.

Работай строго от фундаментальных частей к зависимым.

Пример:

Phase 0
→ Foundation

Phase 1
→ Browser Engine

Phase 2
→ Multi-session Core

Phase 3
→ Pages

Phase 4
→ Browser Actions

Phase 5
→ Concurrency

Phase 6
→ MCP

Phase 7
→ Persistence

Phase 8
→ External MCP Client Multi-Session Demo

BrowserMesh v0.1 не содержит внутренних Agent entities, Agent registry, ownership,
mailboxes или messaging. Reasoning и orchestration выполняет внешний MCP client.

Не перескакивай через фундаментальные незавершённые phases.

---

# 3. Автономный цикл разработки

Для КАЖДОЙ phase выполняй следующий цикл:

IMPLEMENT
↓
TYPECHECK
↓
LINT
↓
UNIT TESTS
↓
INTEGRATION TESTS
↓
E2E TESTS
↓
SELF REVIEW
↓
BUG FIXING
↓
REGRESSION TESTS
↓
ARCHITECTURE REVIEW
↓
DOCUMENTATION UPDATE
↓
повторная полная проверка
↓
только после этого следующая phase

Если любая проверка падает:

не останавливайся.

Исследуй причину → исправь → запусти снова.

---

# 4. Не доверяй собственной первой реализации

После реализации каждого значимого компонента считай, что в нём потенциально есть ошибки.

Активно пытайся их найти.

Проверяй:

* happy path;
* invalid inputs;
* missing resources;
* duplicate operations;
* race conditions;
* concurrency;
* timeouts;
* cleanup;
* shutdown;
* exceptions;
* partial failures;
* repeated execution;
* idempotency where applicable;
* resource leaks;
* stale references;
* cross-session leakage.

---

# 5. Особое внимание BrowserMesh

BrowserMesh существует ради isolation и concurrency.

Поэтому отдельно атакуй эти свойства.

Обязательно попытайся сломать:

## Session isolation

Создавай много sessions.

Проверяй, что между ними не смешиваются:

* cookies;
* localStorage;
* browser contexts;
* pages;
* URLs;
* DOM;
* screenshots;
* authentication state.

## Concurrent sessions

Запускай operations одновременно в разных sessions.

Убеждайся, что глобальный lock случайно не сериализует весь runtime.

## Same-session concurrency

Запускай конфликтующие operations над одной session.

Убеждайся, что session queue / mutex обеспечивает deterministic behavior.

## Lifecycle

Проверяй:

create → use → close.

create → failure.

close twice.

operation during close.

operation after close.

shutdown with active sessions.

shutdown with pending operations.

browser crash/error where practically testable.

## Persistence

Проверяй:

create
→ authenticate/set state
→ save
→ close
→ restart/new context
→ restore
→ verify state.

Проверяй corrupted/missing state files.

## MCP

Проверяй:

* startup;
* tool discovery;
* schemas;
* invalid parameters;
* nonexistent sessionId;
* nonexistent pageId;
* concurrent calls;
* structured errors;
* shutdown.

---

# 6. Stress testing

После функциональной реализации сделай stress testing настолько глубоко, насколько разумно для локальной машины и CI.

Не ограничивайся двумя sessions.

Проверь постепенно, например:

1
2
5
10
25
50

и больше, если окружение позволяет безопасно это делать.

Цель — найти:

* race conditions;
* leaks;
* unbounded listeners;
* hanging promises;
* improper cleanup;
* memory growth;
* incorrect session routing.

Stress tests должны иметь разумные limits и не превращаться в DoS локальной машины.

---

# 7. Regression suite

Каждый найденный реальный bug по возможности сначала воспроизводи тестом.

Затем:

1. создать failing regression test;
2. убедиться, что он действительно воспроизводит проблему;
3. исправить проблему;
4. убедиться, что regression test проходит;
5. запустить весь test suite.

Не исправляй сложные bugs только вручную без regression coverage, если проблему можно выразить тестом.

---

# 8. Self-review после полной реализации

Когда тебе кажется, что всё ТЗ выполнено, НЕ завершай работу.

Сначала проведи отдельный полный аудит проекта.

Представь, что код написал другой разработчик и тебе поручили найти в нём проблемы перед production/open-source release.

Проверь весь repository на:

## Architecture

* dependency direction;
* domain isolation;
* отсутствие Playwright imports в domain/application там, где они запрещены;
* отсутствие прямых Playwright calls из MCP handlers;
* отсутствие global current page/session;
* отсутствие ненужного coupling.

## Concurrency

* race conditions;
* deadlocks;
* queue starvation;
* incorrect shared state;
* missing synchronization.

## Resources

* leaked contexts;
* leaked pages;
* leaked browser handles;
* timers;
* event listeners;
* streams;
* unfinished promises.

## Error handling

* swallowed errors;
* empty catch;
* inconsistent error contracts;
* raw implementation exceptions leaking through public API.

## Security

* secrets in logs;
* auth state committed to Git;
* unsafe filesystem paths;
* path traversal;
* uncontrolled screenshot/output paths;
* arbitrary command execution;
* unsafe input handling.

## Types

* `any`;
* unsafe casts;
* nullable state;
* impossible states;
* inconsistent public interfaces.

## Tests

* meaningless tests;
* missing negative tests;
* nondeterministic/flaky tests;
* excessive mocking hiding real bugs.

## Documentation

* outdated commands;
* APIs differing from implementation;
* missing configuration;
* missing limitations.

Исправь всё найденное.

---

# 9. Fresh-environment verification

После завершения implementation и bug fixing проверь проект так, как будто его скачал новый пользователь.

По возможности:

1. clean install dependencies;
2. build;
3. typecheck;
4. lint;
5. run complete tests;
6. install required Playwright browser;
7. start BrowserMesh;
8. connect through MCP;
9. выполнить documented quickstart;
10. убедиться, что README действительно позволяет запустить проект с нуля.

Нельзя считать проект готовым, если он работает только благодаря случайным файлам или состоянию текущей development environment.

---

# 10. Проверка npm/package usability

Если ТЗ предполагает CLI/npm distribution:

проверь package metadata и фактическую packaged output.

Убедись, что:

* build artifacts входят в package;
* development-only files не попадают без необходимости;
* executable/bin работает;
* imports работают после package build;
* package не зависит от исходников, отсутствующих после публикации;
* README installation commands соответствуют реальности.

По возможности используй локальную упаковку/installation simulation без фактической публикации package.

Не публикуй npm package и не выполняй внешние необратимые действия без моего явного разрешения.

---

# 11. Не скрывай проблемы ради зелёных тестов

Запрещено:

* удалять failing tests только потому, что они падают;
* skip'ать tests без серьёзной технической причины;
* ослаблять assertions ради прохождения;
* отключать strictness;
* маскировать errors;
* добавлять arbitrary sleep вместо исправления race condition;
* увеличивать timeout бесконечно вместо устранения причины;
* mock'ать именно ту часть, которую тест должен проверять.

Исправляй root cause.

---

# 12. Не делай premature infrastructure

Не добавляй ради «production readiness»:

* Kubernetes;
* Redis;
* Kafka;
* RabbitMQ;
* PostgreSQL;
* microservices;
* cloud resources;
* web dashboard;
* SaaS authentication;
* billing.

Если этого нет в текущем scope ТЗ — не реализовывай.

Проект должен оставаться небольшим, понятным modular monolith.

---

# 13. External research

Если сталкиваешься с неизвестным поведением MCP, Playwright, Node.js или используемой библиотеки:

не угадывай.

Проверь актуальную официальную документацию и/или upstream source/issues.

Предпочитай первичные источники.

После исследования возвращайся к реализации самостоятельно.

---

# 14. Git safety

Разрешены обычные локальные изменения проекта.

Запрещены без моего явного разрешения:

* force push;
* удаление remote branches;
* публикация npm package;
* создание cloud infrastructure;
* изменение production systems;
* работа с реальными credentials;
* destructive operations вне repository.

Не уничтожай существующие пользовательские изменения.

---

# 15. Progress

Ты можешь кратко сообщать промежуточный статус, но сообщение о прогрессе НЕ означает остановку работы.

Например:

"Phase 3 завершена, обнаружил race condition в lifecycle, исправляю и продолжаю Phase 4."

После этого продолжай работать самостоятельно.

Не заканчивай turn только потому, что хочешь рассказать статус, если environment позволяет продолжать выполнять работу.

---

# 16. Когда разрешено считать проект завершённым

Работа заканчивается только когда одновременно выполнено ВСЁ:

* все обязательные пункты SPEC реализованы;
* все phases выполнены;
* project build проходит;
* typecheck проходит;
* lint проходит;
* unit tests проходят;
* integration tests проходят;
* e2e tests проходят;
* concurrency tests проходят;
* isolation tests проходят;
* persistence tests проходят;
* MCP tests проходят;
* regression tests проходят;
* clean-environment verification проходит;
* documented quickstart реально работает;
* resource cleanup проверен;
* self-review выполнен;
* найденные при self-review bugs исправлены;
* после исправлений весь suite снова зелёный;
* README соответствует реальности;
* architecture docs соответствуют реальности;
* нет известных blocker/critical/high severity defects, которые можно исправить в рамках текущего scope.

Если какой-либо пункт не выполнен — продолжай работу.

---

# 17. Финальный adversarial pass

После того как ВСЕ предыдущие критерии выполнены, проведи ещё один последний проход с задачей:

"Попытайся доказать, что BrowserMesh ещё НЕ готов."

Ищи:

* скрытые race conditions;
* session leakage;
* cleanup bugs;
* flaky tests;
* broken fresh install;
* incorrect MCP contracts;
* edge cases;
* stale documentation;
* packaging problems.

Если находишь проблему:

исправляй её и снова запускай необходимые проверки.

Повторяй:

AUDIT
→ FIND
→ FIX
→ REGRESSION TEST
→ FULL TEST SUITE

пока новый разумный полный аудит не перестанет находить blocker/critical/high severity defects.

Не зацикливайся на бесконечном cosmetic perfection.

---

# 18. Final response

Только после полного выполнения работы предоставь итоговый отчёт:

1. Что реализовано.
2. Архитектура.
3. Какие phases завершены.
4. Какие tests существуют.
5. Результаты полного test suite.
6. Результаты concurrency/isolation/stress testing.
7. Какие bugs были обнаружены во время self-review и исправлены.
8. Как установить проект с чистого окружения.
9. Как подключить его как MCP.
10. Какие ограничения v0.1 остаются намеренно.
11. Есть ли известные bugs.
12. Что остаётся только future scope, а не незавершённым ТЗ.

Если обязательная часть ТЗ объективно невозможна из-за внешнего ограничения, не выдавай проект за полностью завершённый:

* точно укажи blocker;
* покажи доказательство;
* заверши всё остальное, что не зависит от blocker.

Начинай сейчас.

Сначала полностью изучи repository и SPEC, затем самостоятельно приступай к реализации и продолжай до выполнения Definition of Done.
