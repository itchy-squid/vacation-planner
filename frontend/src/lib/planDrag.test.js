// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dragKind, isLoneProposal } from "./planDrag.js";

const jae = { id: 2, isOwner: false };
const mei = { id: 1, isOwner: true };
const ana = { id: 3, isOwner: false };

const proposal = { id: 10, status: "contested", contestId: 7, createdById: jae.id };
const rival = { id: 11, status: "contested", contestId: 7, createdById: ana.id };
const incumbent = { id: 12, status: "contested", contestId: 7, createdById: null };
const placed = { id: 20, status: "placed", contestId: null, createdById: null };
const locked = { id: 30, status: "locked", contestId: null, createdById: jae.id };

const planner = { canPlan: true, canPropose: true };
const companion = { canPlan: false, canPropose: true };

test("a placed or pencilled plan drags as a plan for anyone who can place", () => {
  assert.equal(dragKind(placed, { plans: [placed], ...planner, currentUser: ana }), "plan");
  assert.equal(dragKind({ ...placed, status: "pencilled" }, { plans: [], ...planner, currentUser: ana }), "plan");
  assert.equal(dragKind(placed, { plans: [placed], ...companion, currentUser: ana }), null);
});

test("a proposal alone in its vote drags its contest, for its author", () => {
  const plans = [proposal, placed];
  assert.equal(isLoneProposal(proposal, plans), true);
  assert.equal(dragKind(proposal, { plans, ...companion, currentUser: jae }), "contest");
});

test("the owner can drag anyone's lone proposal; other members can't", () => {
  const plans = [proposal];
  assert.equal(dragKind(proposal, { plans, ...planner, currentUser: mei }), "contest");
  assert.equal(dragKind(proposal, { plans, ...planner, currentUser: ana }), null);
});

test("a proposal with a competing set stays put", () => {
  for (const other of [rival, incumbent]) {
    const plans = [proposal, other];
    assert.equal(isLoneProposal(proposal, plans), false);
    assert.equal(dragKind(proposal, { plans, ...planner, currentUser: mei }), null);
  }
});

test("someone who can't propose can't drag a proposal", () => {
  const plans = [proposal];
  assert.equal(dragKind(proposal, { plans, canPlan: false, canPropose: false, currentUser: jae }), null);
});

test("locked plans never drag", () => {
  assert.equal(dragKind(locked, { plans: [locked], ...planner, currentUser: mei }), null);
});
