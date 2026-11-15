# Pro Sandcastle

A preset for Sandcastle that makes autonomous coding workflows fit inside a Claude Pro usage window. Plan and merge are done by the human; the sandbox implements and reviews, and each finished Issue is published as a Pull Request.

## Language

**Preset**:
The installable package that configures Sandcastle for this workflow in a project.
_Avoid_: Fork, template, config

**Spec**:
The plan for a feature, written interactively with the human before any sandbox work.
_Avoid_: PRD, plan doc

**Issue**:
One implementable slice of a Spec, stored as a local markdown file with a status.
_Avoid_: Ticket, task, story

**Implementer**:
The sandboxed agent that turns one Issue into commits.
_Avoid_: Worker, coder, executor

**Gate**:
The deterministic checks (tests, typecheck) a change must pass; costs no tokens.
_Avoid_: CI, check, validation

**Review Session**:
An agent pass over an Implementer's changes that produces Findings.
_Avoid_: Code review, reviewer stage

**Finding**:
One problem identified during a Review Session.
_Avoid_: Comment, issue (reserved for Issue)

**Critical Finding**:
A Finding that makes the change wrong: a correctness bug, a contradiction of the Spec or Issue, a security hole, a Gate failure, or data loss. Fixed within the same Review Session.
_Avoid_: Blocker, must-fix

**Non-critical Finding**:
A Finding that makes the change worse but not wrong, such as style, naming, or simplification. Logged on the Issue for the human.
_Avoid_: Nit, suggestion

**Coding Standards**:
The rules a Review Session checks changes against. They come in three layers that override one another: Preset, Personal, then Project. The Project layer wins.
_Avoid_: Style guide, conventions, lint rules

**Must Rule**:
A Coding Standard marked as mandatory. Breaking it is a Critical Finding rather than a Non-critical one.
_Avoid_: Hard rule, required standard

**Stacked Issue**:
An Issue started on top of the branch of its one blocker that is not yet merged. It is reviewed against that blocker, and it is only done once it reaches the target branch.
_Avoid_: Dependent PR, chained Issue

**Pull Request**:
The published form of one Issue's branch, opened once it passes the Gate, which the human reviews and merges.
_Avoid_: PR (in prose), merge request

**Run**:
One invocation of the Preset, which takes Issues through implementation, Review Session, and Gate one at a time.
_Avoid_: Job, loop, session

**Pause**:
The state of an Issue whose Run stopped because the usage limit was reached. It is resumed before any new Issue is picked.
_Avoid_: Suspend, abort
