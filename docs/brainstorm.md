# YiboLabel Brainstorm

## Why This Project Exists

The original vendor software is usable but frustrating:

- too many non-essential features
- poor template experience
- template availability limited by membership level
- requires network access and account login
- too much UI and workflow overhead for simple printing

The project exists to build a practical local replacement for personal use.

## Product Direction

YiboLabel should be:

- offline-first
- local-first
- simple to launch and use
- focused on core printing tasks
- free from account and cloud dependencies

YiboLabel should not try to become a cloud platform.

## Core Capabilities

The minimum useful product should cover:

- printer connection
- label canvas and editing
- local template save/load
- print preview
- print execution

## Non-Goals

The first versions should avoid:

- cloud sync
- login/account system
- member-only assets
- online template store
- chat, push, or notifications
- team or enterprise collaboration
- feature-heavy content platforms

## Architecture Thoughts

At a high level, there are three possible routes:

## Route A: Fully Rebuilt Local Desktop App

Build a standalone desktop application with:

- local UI
- local template storage
- local printer communication

This is the cleanest long-term direction.

## Route B: Local App Using System Print Path

Render the label to an image or print surface and rely on the Windows print path when the printer supports it.

This is easier if the printer behaves like a standard Windows printer.

## Route C: Local Service Plus Client

Split the app into:

- a local backend service
- a desktop or web-based local UI

If this route is used, default connection style should prefer `http`, not `websocket`, unless a later requirement truly needs real-time streaming.

## Current Technical Signals

From the installed Dlabel software, the following signals look important:

- the app appears to be a Qt-based desktop application
- it includes local print-related modules such as `DPrintCore.dll` and `USBApi.dll`
- logs show direct USB printer interaction
- cloud URLs appear to be tied to login, template, sync, and membership features

This strongly suggests the essential local printing capability is separable from the cloud product layer.

## Product Experience Goal

YiboLabel should feel like a label-focused design tool, not a membership platform.

The intended experience:

- open fast
- detect printer clearly
- edit on a true-size canvas
- save everything locally
- print without friction

## Suggested Early Focus

Keep the first version narrow:

- USB printer support first
- a few fixed label sizes first
- text, barcode, QR code, image, line, and rectangle elements first
- local templates only
- simple print settings only

Anything beyond that should wait until the printing pipeline is stable.
