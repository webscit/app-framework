# Simulation engineer (main persona)

This file describe the user stories for _Simulation Engineer_ persona (the main persona for the applications built on top of the framework).

## Persona

Simulation Engineer:
- Builds simulation systems using simulation tools such as CoSApp,
OpenMDAO, Genesis, or other engines to perform analysis to address
technical queries; e.g. what would be the fuel consumption of a new engine
for that hypothetical airplane, is the drone still stable on reference missions
with the weight of that drone part increased by 100 grams.
- Needs to create simulation scenarios, execute them and post-process their results to answer
the query. 
- Should be able to create a working dashboard in 3 lines of Python, 
from a text prompt or from a no-code editor.

## Stories

### New workspace

> A workspace is here the persisted application state used by the engineer to answer one technical query.

Applications built with the framework should by default display the following widgets:
- Workspace controllers: open workspace, close workspace, save workspace
- Application connection status with the simulation tool
- Simulation tool logs
- Simulation scenario definition(s); this widget will likely be simulation tool dependent
- Simulation controllers: start simulation, stop simulation
- Simulation validation: this widget highlight if the simulation results are valid - apply only if constraints have be formulated
- AI assistant panel
- [optional] result viewer(s)

On new workspace, the user should be welcomed by a dialog _from the AI assistant_ requesting the following
information - in a multi steps dialog:
- what is the user goal for this workspace? / what is the user trying to figure out?
- what are the simulation scenarios?
- what are the validation constraints?

> The dialog could be skipped at any time by the user.

If the user answered all questions, it can either press a "Create Raw Workspace" or "Create Suggested Workspace".
In the first case, the user answers are only stored as workspace metadata. In the second case, the AI assistant
panel is opened and a AI request is sent with the purpose of modifying the simulation setup and (then) the dashboard
widgets to fit the user answers.
Per design, all AI modifications will be gated through user explicit approval.

### Open workspace

When an user is returning to a workspace (by opening it or when the application is restarted loading the latest workspace),
a notification _from the AI assistant_ should offer the AI assistance to modify the workspace.

### On simulation run

If validation criteria are failing for a given simulation, the AI assistant should be automatically called with the failing
criteria and simulation context to provide suggestions to fix the simulation if it can. If the assistant found some suggestions,
display a notification to the user to propose helping him to fix the simulation. If the user accept, the AI assistant panel
will open displaying the fix suggestions.

> In case the user, changes the simulation parameters while the AI assistant is looking for fixes. Abort looking for fixes AI
> request.
