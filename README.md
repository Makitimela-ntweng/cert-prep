# Mock Exam Center

A Microsoft-style practice exam site. Plain HTML, CSS and JavaScript, so it deploys to Vercel's free Hobby plan with no build step.

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app |
| `dump.txt` | The exam everyone sees. Replace it with your own dump (or use `dump.json`). |
| `config.js` | Supabase keys. Leave empty to run without accounts. |
| `supabase/schema.sql` | Database tables and security rules for accounts |

## 1. Add your exam

Replace `dump.txt` with your exam dump. Format:

```
Exam: AZ-104 Microsoft Azure Administrator

Section: Manage Azure identities and governance (20–25%)
Topic: Manage Microsoft Entra users and groups

QUESTION 1
Question text...
A. Option
B. Option
C. Option
D. Option
Answer: B
Explanation: Optional.
```

- Questions 1–50 become Exam 1, 51–100 Exam 2, 101–150 Exam 3 (more exams appear if the dump is longer).
- Progress is saved per `Exam:` title and question number. Fixing typos is safe; reordering or inserting questions shifts saved progress onto different questions, so add new questions at the end.

## 2. Set up accounts (free Supabase project)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key into `config.js`.
   The anon key is designed to be public. Row-level security in the schema stops anyone reading another user's data.
   Never put the `service_role` key in this project.
4. After your first Vercel deploy, open **Authentication → URL Configuration** and set **Site URL** to your Vercel address (for example `https://mock-exams.vercel.app`). Confirmation and password-reset emails link there.

Free-tier limits to know about:
- Supabase's built-in email sender only allows a few emails per hour. For a small group you can turn off **Authentication → Providers → Email → Confirm email** so people can sign in straight away, or connect your own SMTP server.
- Free Supabase projects pause after about a week with no activity. Restore them from the dashboard.

Without keys in `config.js` the site still works: everyone practises as a guest and progress is saved in their browser. When a guest later creates an account, their browser progress is copied into it.

## 3. Deploy to Vercel (free)

Either:

- Push this folder to a GitHub repository, then in Vercel choose **Add New → Project**, import the repository, set **Framework Preset** to **Other**, and deploy. Every push redeploys.

or, from this folder:

```bash
npx vercel
```

and `npx vercel --prod` for the production URL.

## Running locally

The app fetches `dump.txt`, so open it through a local server rather than double-clicking `index.html`:

```bash
npx serve .
```
