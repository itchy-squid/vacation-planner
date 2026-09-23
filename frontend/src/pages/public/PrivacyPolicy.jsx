import { PublicFooter, PublicHeader } from "./PublicLayout";

// The public privacy policy at /privacy — linked from the homepage and
// footer, and the URL given to Google's OAuth consent screen ("Privacy
// policy link") for brand verification. It has to describe what we do
// with Google user data specifically, hence its own section below.
//
// Keep it true to the code: if what we collect or where it goes changes
// (backend/app/models.py, photo_storage.py, infra/), update this page and
// LAST_UPDATED. CONTACT_EMAIL must be a real, monitored address before
// the page is submitted to Google.

const LAST_UPDATED = "September 22, 2026";
const CONTACT_EMAIL = "[CONTACT EMAIL]";

export default function PrivacyPolicy() {
  return (
    <div className="pub">
      <PublicHeader />

      <main className="pub-wrap">
        <article className="pub-doc">
          <div className="pub-doc-intro">
            <div className="pub-eyebrow">Last updated {LAST_UPDATED}</div>
            <h1>Privacy policy</h1>
            <p>
              Vacation Planner is a shared planner for group trips. This policy explains what information we collect
              when you use it, what we do with it, who can see it, and how to have it deleted.
            </p>
          </div>

          <section>
            <h2>What we collect</h2>
            <p>
              <strong>Your account details.</strong> You sign in with a Google or Microsoft account. When you do, that
              provider tells us your name, your email address, and an ID for your account. We never see or store your
              password.
            </p>
            <p>
              <strong>What you add to a trip.</strong> This includes trips, the places you pin (with their notes, links,
              tags and costs), schedules and proposals, votes, comments, and expenses. If you add a photo by pasting an
              image link, we save a copy of that image in private storage so the trip doesn’t depend on the original
              website.
            </p>
            <p>
              <strong>Technical information.</strong> Like most websites, our servers log requests, which can include
              your IP address, your browser type, and the time of the request. We use these logs only to keep the
              service running and secure, and we delete them after 30 days.
            </p>
          </section>

          <section>
            <h2>Cookies and browser storage</h2>
            <p>We don’t use advertising or analytics cookies. We store only what sign-in needs:</p>
            <ul>
              <li>A session cookie that keeps you signed in.</li>
              <li>A note in your browser of whether you last signed in with Google or Microsoft, so we can take you back to the same one.</li>
              <li>For a few minutes during sign-in, the page you were trying to open, so you land back on it.</li>
            </ul>
          </section>

          <section>
            <h2>How we use your information</h2>
            <ul>
              <li>To sign you in and keep you signed in.</li>
              <li>To show the people on your trips who added each place, vote, comment and expense.</li>
              <li>To run the planner’s features, such as schedules, voting and splitting costs.</li>
              <li>To keep the service secure and fix problems.</li>
            </ul>
            <p>We don’t sell your information, show you ads, or use your information to advertise to you.</p>
          </section>

          <section>
            <h2>Google user data</h2>
            <p>
              When you sign in with Google, we ask only for basic sign-in access (your name, email address and
              profile). We don’t ask for, and can’t see, your Gmail, Google Drive, Contacts, Calendar or any other
              Google data. We use your name and email address only as described in this policy: to sign you in and to
              identify you to the people on your trips. We don’t transfer this data to anyone else except as described
              under “Who we share it with”.
            </p>
            <p>
              Vacation Planner’s use and transfer of information received from Google APIs follows the{" "}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
                Google API Services User Data Policy
              </a>
              , including its Limited Use requirements.
            </p>
            <p>
              You can remove Vacation Planner’s access to your Google account at any time from your{" "}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
                Google Account permissions page
              </a>
              .
            </p>
          </section>

          <section>
            <h2>Who can see your information</h2>
            <p>
              Only the people on a trip can see that trip. They can see your name and email address, and everything you
              add to the trip. A trip’s owner decides who joins, usually by sharing an invite link, and can remove
              people. Anyone who has an active invite link can use it to join, so share links only with people you
              want on the trip.
            </p>
          </section>

          <section>
            <h2>Who we share it with</h2>
            <p>We don’t sell or rent your information. We share it only:</p>
            <ul>
              <li>
                With <strong>Microsoft Azure</strong>, which hosts our servers, database, photo storage and logs on our
                behalf.
              </li>
              <li>
                With <strong>Google or Microsoft</strong>, when you use them to sign in.
              </li>
              <li>When the law requires it, or to protect the safety of our users or the service.</li>
            </ul>
          </section>

          <section>
            <h2>Keeping and deleting your information</h2>
            <p>
              We keep a trip’s content for as long as the trip exists. You can delete places and proposals you’ve
              added, and a trip’s owner can remove people from the trip.
            </p>
            <p>
              To have your account information and everything you’ve added deleted, email us at {CONTACT_EMAIL}. We’ll
              do it within 30 days. Server logs are deleted automatically after 30 days.
            </p>
          </section>

          <section>
            <h2>Security</h2>
            <p>
              All traffic to Vacation Planner is encrypted with HTTPS. Photos are kept in private storage, and each
              link to one stops working after a few hours. Access to our systems is limited to the people who run the
              service.
            </p>
          </section>

          <section>
            <h2>Children</h2>
            <p>Vacation Planner isn’t meant for children under 13, and we don’t knowingly collect their information.</p>
          </section>

          <section>
            <h2>Changes to this policy</h2>
            <p>
              If we change this policy, we’ll update it here and change the date at the top.
            </p>
          </section>
        </article>
      </main>

      <PublicFooter />
    </div>
  );
}
