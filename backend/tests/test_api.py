"""API contract tests."""

import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_reports_a_solved_strategy(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["solver"]["iterations"] > 0
    # The served solution must be at least as good as the headline claim.
    assert body["solver"]["percent_of_ante"] < 1.0


def test_rules_and_info_sets(client):
    rules = client.get("/api/game/rules").json()
    assert rules["info_sets"] == 12 and rules["deals"] == 6
    assert len(rules["histories"]) == 9

    info = client.get("/api/game/info-sets").json()["info_sets"]
    assert len(info) == 12
    assert {i["key"] for i in info} >= {"J", "Kpb", "Qb"}


def test_theory_endpoint_is_unexploitable(client):
    body = client.get("/api/game/theory?alpha=0.25").json()
    assert body["exploitability"] == pytest.approx(0.0, abs=1e-12)
    assert body["game_value"] == pytest.approx(-1 / 18)


def test_theory_rejects_alpha_outside_the_family(client):
    assert client.get("/api/game/theory?alpha=0.9").status_code == 422


def test_baselines_are_ranked_by_exploitability(client):
    rows = client.get("/api/game/baselines").json()["baselines"]
    assert len(rows) == 7
    values = [r["exploitability"] for r in rows]
    assert values == sorted(values, reverse=True)


def test_training_run_converges_and_streams_snapshots(client):
    run_id = client.post("/api/runs",
                         json={"variant": "cfr+", "iterations": 2000}).json()["run_id"]
    for _ in range(150):
        if client.get(f"/api/runs/{run_id}?include_strategy=false").json()["status"] != "running":
            break
        time.sleep(0.1)

    body = client.get(f"/api/runs/{run_id}").json()
    assert body["status"] == "done"
    assert len(body["snapshots"]) > 5
    assert body["exploitability"] < 1e-3
    # Solved strategy must sit inside the analytical equilibrium family.
    assert max(body["deviation"].values()) < 0.02


def test_run_rejects_a_bad_variant(client):
    assert client.post("/api/runs",
                       json={"variant": "mcts", "iterations": 100}).status_code == 400


def test_missing_run_is_404(client):
    assert client.get("/api/runs/deadbeef").status_code == 404


def test_ablation_shows_cfr_plus_beating_vanilla(client):
    body = client.get("/api/ablation?iterations=2000").json()
    by_variant = {r["variant"]: r for r in body["results"]}
    assert by_variant["cfr+"]["final_exploitability"] < \
        by_variant["vanilla"]["final_exploitability"] / 10
    # Vanilla's *current* iterate never settles; only its average does.
    assert by_variant["vanilla"]["current_strategy_exploitability"] > 5e-2


def test_evaluation_separates_equilibrium_from_exploitative(client):
    body = client.post("/api/evaluate", json={"hands": 5000}).json()
    assert len(body["results"]) == 7
    summary = body["summary"]
    # The exploitative agent must win more; that is the whole point of it.
    assert summary["exploitative_mean_ev"] > summary["nash_mean_ev"]
    # The epsilon-Nash guarantee, asserted exactly: a strategy measured at
    # exploitability eps can lose at most eps per hand to ANY opponent. Using a
    # fixed tolerance here instead would either be too loose to mean anything
    # or fail whenever the served solution is a little less converged.
    epsilon = body["exploitability"]
    for row in body["results"]:
        assert row["nash"]["ev_per_hand"] >= -epsilon - 1e-12
        assert row["exploitative"]["ev_per_hand"] >= row["nash"]["ev_per_hand"] - 1e-9


def test_play_a_full_hand(client):
    table = client.post("/api/play/tables",
                        json={"opponent": "honest", "human_seat": 0, "seed": 7}).json()
    tid = table["table_id"]
    state = client.post(f"/api/play/tables/{tid}/deal").json()
    assert state["hand"]["your_card"] in ("J", "Q", "K")

    guard = 0
    while not state["hand"]["finished"] and guard < 5:
        assert state["hand"]["your_turn"]
        # Opponent's card must stay hidden while the hand is live.
        assert "bot_card" not in state["hand"]
        action = state["hand"]["hint"]["best_action"]
        state = client.post(f"/api/play/tables/{tid}/act", json={"action": action}).json()
        guard += 1

    assert state["hand"]["finished"]
    assert state["hand"]["bot_card"] in ("J", "Q", "K")  # revealed at the end
    assert state["session"]["hands_played"] == 1
    # We played the coach's own recommendation, so nothing was left on the table.
    assert state["session"]["ev_lost"] == pytest.approx(0.0, abs=1e-9)
    assert state["session"]["mistakes"] == 0


def test_cannot_act_before_dealing(client):
    tid = client.post("/api/play/tables", json={"opponent": "nash"}).json()["table_id"]
    assert client.post(f"/api/play/tables/{tid}/act",
                       json={"action": "b"}).status_code == 400


def test_unknown_opponent_is_rejected(client):
    assert client.post("/api/play/tables",
                       json={"opponent": "gto_wizard"}).status_code == 400
