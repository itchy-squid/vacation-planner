"""Non-API navigations on the API host redirect to the SPA (app/routers/spa_redirect.py)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

FRONTEND = "https://vacations.example.com"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", FRONTEND)
    get_settings.cache_clear()
    yield TestClient(app, follow_redirects=False)
    get_settings.cache_clear()


def test_root_redirects_to_spa(client):
    res = client.get("/")
    assert res.status_code == 302
    assert res.headers["location"] == f"{FRONTEND}/"


def test_deep_path_and_query_are_kept(client):
    res = client.get("/trips/1/board?x=1")
    assert res.headers["location"] == f"{FRONTEND}/trips/1/board?x=1"


def test_double_slash_cannot_change_host(client):
    res = client.get("//evil.example.com/x")
    assert res.headers["location"].startswith(f"{FRONTEND}/")


def test_real_routes_still_win(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/api/me").status_code == 200


def test_unknown_api_path_404s(client):
    assert client.get("/api/nope").status_code == 404
    assert client.get("/api").status_code == 404


def test_post_is_not_redirected(client):
    assert client.post("/").status_code == 405


def test_no_frontend_url_means_404(monkeypatch):
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    get_settings.cache_clear()
    assert TestClient(app, follow_redirects=False).get("/").status_code == 404
    get_settings.cache_clear()
