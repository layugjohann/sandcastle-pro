# Each Issue that passes the Gate is published as a Pull Request

Amends 0002. The human still plans and merges, but now reviews each finished Issue as a Pull Request on GitHub instead of its local branch. After an Issue passes the Gate, the host pushes its branch and opens a Pull Request against the target branch. An agent call only writes the body, using the `pr` template. Pushing and creating the Pull Request are deterministic host steps, so the sandbox never holds GitHub credentials and no tokens are spent on git plumbing. Only Issues whose remaining Findings are all Non-critical are published. An unfixed Critical Finding is handled like a Gate failure: the Gate is skipped, the Issue goes to `ready-for-human`, and the Run stops. There is no second Review Session to retry the fix, because 0002 allows one per Issue. Issues that fail the Gate or have a Spec disagreement are not published either. The feature is opt-in through config, because not every project using the Preset has a GitHub remote and `gh`.

## Consequences

- An Issue with a Pull Request is done when GitHub reports it merged, not when its branch is an ancestor of the local target branch. That local check could not see squash merges, or merges you have not pulled yet.
- The sandbox still never merges. The Pull Request is where the human reviews; the merge button stays with the human.
