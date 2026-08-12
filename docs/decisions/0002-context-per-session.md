# ADR 0002: One BrowserContext per session

Status: Accepted

One shared Chromium process hosts one non-persistent `BrowserContext` per ready BrowserSession. Context isolation directly supplies separate cookies, localStorage, and pages at substantially lower cost than a browser process per session. Contexts are never shared by independent sessions and are closed with their session.
