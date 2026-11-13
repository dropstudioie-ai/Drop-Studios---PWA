# Drop Design

A private design studio for the Drop Studios team. You can make posters, social posts, timetables, presentations and Drop event artwork, and the owner can also create invoices.

## Who can use it

You sign in with your **Drop account**.

| Who | Designs, templates, Brand Kit, Drop event artwork | Invoices |
|---|---|---|
| Owner (full admin) | ✅ | ✅ |
| Manager (e.g. Ana) | ✅ | ❌ |
| Instructors | ✅ (artwork only for their own events) | ❌ |
| Members, anyone else | ❌ | ❌ |

## Run it on your computer

You need **Node.js 20 or newer** (from https://nodejs.org).

```bash
cd drop-design
npm install
npm run dev
```

Then open **http://localhost:5180** and sign in with your Drop email and password.

To build a production copy:

```bash
npm run build
npm run preview   # serves it on http://localhost:5181
```

## Where your work is saved

Everything is saved **in the browser on the device you use**: designs, uploads, your Brand Kit, invoices, clients and bank accounts. This storage is called IndexedDB.

- It saves automatically as you work, and keeps working offline once loaded.
- **Limits:**
  - It's per browser and per device. A design made in Chrome on your laptop isn't on your phone.
  - Clearing your browser's site data deletes it.
  - The browser can also free space under storage pressure. The app asks it not to, but it's best effort.
- **Back up** with Designs → *Download backup*. It saves one file with everything, including uploads and, for the owner, invoices. Restore it with *Restore a backup*.
- To pass a single design to someone, use the *Share* button and choose **Download editable project file**. They open it with *Import*.

All storage goes through small repositories in `src/storage/db.ts` and `src/invoices/store.ts`. Moving to cloud storage with accounts (phase 3) means swapping those for server calls. The screens don't change.

## Drop event artwork

1. Go to **Drop events** and pick an event. Create the event in the Drop app first (Organise an event).
2. Write the brief: title, date, what to wear, the look you want, and the pictures that must be used.
3. Click **Show me design options**. You get 4 layouts, with colours and fonts picked from the theme. For example "Halloween" gives spooky colours and "All Black" gives black with lime.
4. Pick one. It opens fully editable in the editor.
5. Click **Send to Drop**, check the preview, then **Approve & publish to Drop**. The image is uploaded and shown on the class in the Drop app.

The design options come from built-in rules, not AI. An AI option needs an AI service key and can be added later.

## Invoices (owner only)

**New invoice** asks four things:
1. Who is it for?
2. How much, and for what?
3. Is VAT included?
4. Which bank account should it be paid into?

It then shows the invoice for approval. Approving gives it the next number in sequence (e.g. `DS-2026-001`). From the invoice you can:
- download the PDF;
- **Send from Gmail**;
- mark it paid, or cancel it.

The Invoices page shows:
- totals for the year;
- what's still waiting to be paid, and what's overdue;
- average time to get paid;
- top clients;
- VAT charged per two-month return period.

The wizard also learns from past invoices. It suggests what you usually bill a client and which account they pay into.

**Gmail sending**
- Without setup, *Open Gmail draft* downloads the PDF and opens a ready-written Gmail message for you to attach it and send.
- To send directly, with the PDF attached, add a Google OAuth **client ID** in *Invoice settings*.
  - Make it in Google Cloud Console → APIs & Services → Credentials → *OAuth client ID* → *Web application*.
  - Add the app's address (e.g. `http://localhost:5180`) under *Authorised JavaScript origins*.
  - Enable the Gmail API.
- The app only asks for permission to *send* email.

## Tests

```bash
npm test            # unit tests (editor history, invoice maths, event options)
npm run build && npm run e2e   # full browser test of every workflow (offline, fake Drop server)
```

`ONLY=editor npm run e2e` runs one part. The parts are `access`, `editor`, `templates`, `drop`, `invoices` and `tablet`.

## Images and licences

- **Photos:** Drop Studios' own studio photos.
- **Illustrations, backgrounds and templates:** original, made for this app.
- **Icons:** Lucide (ISC licence).
- **Fonts:** Google Fonts (Open Font Licence).

There is no third-party stock library.

## Roadmap

- **Phase 1 (done):** editor, text, shapes, images, uploads, layers, undo/redo, templates, saving, PNG/JPG/PDF export.
- **Phase 2 (mostly done):**
  - done: Brand Kit, advanced text, image crop and filters, multiple pages, alignment and grouping, template categories and search.
  - next: more templates, and an on-canvas crop tool.
- **Phase 3:** cloud accounts and storage, share links, live collaboration, AI design suggestions.
