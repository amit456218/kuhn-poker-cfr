"""
FastAPI application for the Kuhn poker Nash equilibrium solver.

Run with:  uvicorn app.main:app --reload --port 8000
Docs at:   http://localhost:8000/docs
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import game, play, solver
from .solution import DEFAULT_SOLUTION, REFINED_ITERATIONS, WARMUP_ITERATIONS


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Solve coarsely before serving the first request, then keep refining in
    # the background. See app/solution.py for why it is split in two.
    DEFAULT_SOLUTION.warm_up()
    yield


app = FastAPI(
    title="Kuhn Poker Nash Equilibrium Solver",
    version="1.0.0",
    description=(
        "Counterfactual Regret Minimization applied to Kuhn poker, with exact "
        "exploitability measurement against the game's known closed-form "
        "solution."
    ),
    lifespan=lifespan,
)

# The Next.js dev server runs on a different origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(game.router)
app.include_router(solver.router)
app.include_router(play.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    report = DEFAULT_SOLUTION.report()
    return {
        "status": "ok",
        "solver": {
            "variant": report["variant"],
            "iterations": report["iterations"],
            "exploitability": report["exploitability"],
            "percent_of_ante": report["percent_of_ante"],
            "refining": report["refining"],
            "warmup_iterations": WARMUP_ITERATIONS,
            "refined_iterations": REFINED_ITERATIONS,
        },
    }
