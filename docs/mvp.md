# YiboLabel MVP

## One-Sentence Goal

Build a local Windows label printing app for personal use that can connect to a printer, edit common label content, save templates locally, and print without login or cloud dependency.

## Target User

The primary user is the author of the project.

This means the MVP should optimize for:

- practical usefulness
- low setup cost
- predictable behavior
- maintainability over broad compatibility

## Must-Have Features

- detect and select a supported printer
- create a label with fixed canvas size
- add and edit text
- add and edit barcode
- add and edit QR code
- add and position image content
- draw simple shapes such as lines and rectangles
- save template locally
- reopen and edit saved template
- preview before printing
- print selected copies

## Nice-to-Have Features

- recent files
- print history
- darkness or density setting
- rotation
- alignment tools
- duplicate element

## Explicitly Out of Scope

- account system
- online login
- cloud sync
- paid template catalog
- multi-user collaboration
- remote job management
- plugin ecosystem

## Technical Priorities

1. Confirm the printer communication path.
2. Make one printer print reliably.
3. Keep template format local and simple.
4. Keep the editor small and predictable.

## Practical Milestones

## Milestone 1: Proof of Print

Goal:
Send a minimal label successfully to the target printer.

Success looks like:

- printer can be detected
- one simple label can be printed
- output size and direction are understandable

## Milestone 2: Basic Editor

Goal:
Create and edit common label layouts.

Success looks like:

- text and code elements are editable
- positions can be adjusted visually
- label size is represented clearly

## Milestone 3: Local Templates

Goal:
Reuse labels without depending on vendor systems.

Success looks like:

- templates can be saved
- templates can be reopened
- templates remain readable and stable

## Milestone 4: Everyday Usability

Goal:
Make the app pleasant enough to replace the vendor software for daily use.

Success looks like:

- common printing tasks require fewer steps
- the interface stays focused
- no network or login requirement blocks work
