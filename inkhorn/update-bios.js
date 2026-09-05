#!/usr/bin/env node
/**
 * Push corrected contributor bios to Ghost tag descriptions.
 * Book titles are marked with *asterisks* — the ebook builder renders these as italic.
 *
 * Usage: node inkhorn/update-bios.js
 */
'use strict';

const crypto       = require('crypto');
const { execSync } = require('child_process');

// ── Corrected bios (slug → description) ──────────────────────────────────────
// Fixes applied:
//   victoria-k-butler  — removed surrounding quotation marks
//   zhu-xiao-di        — italicised *Thirty Years in a Red House*
//   william-doreski    — italicised *Cloud Mountain*, *Robert Lowell's Shifting Colors*
//   e-p-lande          — italicised *Aaron's Odyssey*, *To Have It All*, *Dancing With Katie*
//   lindaann-loschiavo — italicised four book titles
//   d-s-maolalai       — italicised *Noble Rot*, added terminal period
//   rikki-santer       — italicised *Resurrection Letter*, *Shepherd's Hour*, *Could Be*
//   gerard-sarnat      — removed "MD", italicised four titles
//   l-m-scarpitto      — restored leading "L"
//   barbara-daniels    — italicised *Talk to the Lioness*
//   veronica-tucker    — italicised *The House as Witness*
//   christine-jackson  — normalised double space

const BIOS = {
  'sam-agar':
    'Sam Agar is working as an Editor for Sans. PRESS. With a BA in English and Film Studies, Sam has also completed a Masters in Creative Writing and has been published in Puca Magazine, Silver Apples magazine and the Cabinet of Heed.',

  'sergey-bielecki':
    'Sergey Bielecki is a queer writer from Russia. Featured in The Rye Whiskey Review. His interview with Richard Siken appears in Polymnia which he leads. His collection will be featured in Blood Moon Review. He\'s mentored by Yona Harvey. The Porter-Phelps Museum has him researching Native American creative arts.',

  'victoria-k-butler':
    'Victoria studied journalism and English literature at San Francisco State University, where she learned to love stories that question the way we see the world. Now, she\'s a PR pro by trade, fiction writer by hobby. You can find her work in Press Pause Press, Glint Literary Journal, and forthcoming in Inglenook Literary.',

  'barbara-daniels':
    'Barbara Daniels\' most recent book, *Talk to the Lioness*, was published by Casa de Cinco Hermanas Press. Her poetry has appeared in Main Street Rag, Free State Review, Philadelphia Stories, and many other journals. She received four fellowships from the New Jersey State Council on the Arts.',

  'zhu-xiao-di':
    'Zhu Xiao Di is the author of *Thirty Years in a Red House* (University of Massachusetts Press; Penguin Books), a novel, collections of essays in Chinese, and over 170 poems published in journals in the U.S., Singapore, U.K., Sweden, and Canada. Shortlisted for the 2026 Silent River Poetry Prize.',

  'william-doreski':
    'William Doreski lives in Peterborough, New Hampshire. He has taught at several colleges and universities. His most recent book of poetry is *Cloud Mountain* (2024). He has published three critical studies, including *Robert Lowell\'s Shifting Colors*. His essays, poetry, fiction, and reviews have appeared in various journals.',

  'louis-faber':
    'Louis Faber\'s work has appeared numerous anthologies and in The MacGuffin, Cantos, The Poet, Alchemy Spoon, Dreich (Scotland), Prosetrics, Passager, Atlanta Review, Glimpse, Rattle, Pearl, The South Carolina Review among others, and was twice nominated for both a Pushcart and Best of the Net Prize.',

  'james-lewis-huss':
    'James Lewis Huss is a poet, playwright, and novelist who has taught English Literature around the world. He currently teaches literature and film at an international school in Washington, DC.',

  'christine-jackson':
    'Christine Jackson is retired and still recovering from her day job as a professor of literature and creative writing at a South Florida university. She continues to clock in on a life-long night shift writing poetry.',

  'robin-kathaas':
    'Robin Kathaas is a poet who was born and raised in Belgium, but now lives, laughs, and loves in Brighton. Their cat is more interesting than they are. They can be found on Instagram at @robin.kathaas.',

  'j-a-keefe':
    'Originally from London, J. A. Keefe has lived and worked in Valencia, Spain for many years.',

  'e-p-lande':
    'E.P. Lande, born in Montreal, lived in France, now in S. Carolina, taught at l\'Université d\'Ottawa (Vice-Dean), and owned country inns/restaurants. More than 140 of his stories have found homes all over. Novels *Aaron\'s Odyssey*, *To Have It All*, psychotic thrillers, and *Dancing With Katie*, have been published in London.',

  'alyse-levalley':
    'Alyse LeValley is a teacher and writer living in central California.',

  'susan-long':
    'Susan Long has published stories in Voices of Lung Cancer; Appalachia Bare; Still: The Journal; Appalachian Journal; Litmosphere: Journal of Charlotte Lit; Twisted Vine Literary Arts Journal; and Four Tulips Literary Magazine. Her story, "Oracle of Lady Elk," is forthcoming in the 2026 fall issue of The Red Branch Review.',

  'lindaann-loschiavo':
    'New Yorker LindaAnn LoSchiavo is a member of BFS, HWA, SFPA, etc. 2024 titles: *Always Haunted: Hallowe\'en Poems* + *Apprenticed to the Night* + *Felones de Se: Poems about Suicide*. Accolades: Elgin Award for *A Route Obscure and Lonely*; Chrysalis BREW Project\'s Excellence Award for *Always Haunted: Hallowe\'en Poems*, etc.',

  'd-s-maolalai':
    'DS Maolalai has been described by one editor as "a cosmopolitan poet" and another as "prolific, bordering on incontinent". His work has been nominated fourteen times for BOTN, eleven for the Pushcart and once for the Forward Prize, and released in three collections, most recently *Noble Rot* (Turas Press, 2022).',

  'jackie-mcclure':
    'Jackie McClure writes poetry and fiction aiming to illuminate the commonplace in our shared landscapes. Recent poetry can be found in Split Rock Review, Wild Roof Journal, Mocking Heart Review, and on her Substack site at Pouring Word Tea. She lives in the northwest corner of Washington State.',

  'elizabeth-f-a-meaney':
    'Elizabeth F.A. Meaney is a dual citizen of Ireland and the U.S. who teaches English in France. She has an MFA in Poetry and has published three novels.',

  'thomas-nance':
    'Thomas Nance is a study in contrasts. He is as comfortable watching a wrestling match as he is a Broadway musical. So, yeah, he\'s basically a nut job that continues to play with words as a writer, an audiobook narrator, and podcast host.',

  'kenny-norton':
    'A former English teacher, Kenny Norton leads a digital marketing team and is new to publishing poetry although he has published theatre reviews and feature articles.',

  'lee-rohe':
    'Lee Rohe was born in Virginia, and raised in Key Largo, FL. He is a produced playwright and the recipient of a Florida Fellowship Grant in playwriting. His teleplay, "Cross Creek Under Cross Exam," was aired by Florida Public Television. His plays have been staged off-Broadway and throughout Florida.',

  'patricia-russo':
    'Patricia Russo\'s work has appeared in One Art, Identity Theory, Michigan City Review, The Bloomin\' Onion, and Verity La.',

  'mark-sabourin':
    'Mark Sabourin has set aside his career as a business journalist to focus on fiction. He has appeared in The Antigonish Review, Fine Lines, Across the Margin, Drift & Dribble, and Sudden Flash. He shares a home near the town of Campbellford, Ontario, Canada, with his partner Maria.',

  'sameer-saklani':
    'Sameer Saklani is a Brooklyn-born writer, factotum, and creature of matter, now residing closer to the equator with his loved ones. He explores the humananimal condition alongside the qualities of language. His work appears in Eunoia, Sam Hill! Review, Rivener Lit, Bokeh Review, Mobius, and elsewhere. hello&goodluck.',

  'rikki-santer':
    'Rikki Santer\'s poetry collection, *Resurrection Letter* was grand prize short-listed for the Eric Hoffer Book Award and *Shepherd\'s Hour*, won the Paul Nemser Book Prize from Lily Poetry Review Books. In 2023, she was named Ohio Poet of the Year, in 2026 she served as Artist-in-Residence at the Fran Ryan Center in Columbus, Ohio and is a member of the teaching artist roster of the Ohio Arts Council. Her fifteenth poetry collection, *Could Be*, was published this spring by Sheila-Na-Gig Press.',

  'terry-sanville':
    'Terry Sanville lives in San Luis Obispo, California with his artist-poet wife (his in-house editor) and two plump cats (his in-house critics). His short stories have been accepted more than 600 times by journals, magazines, and anthologies. Terry is a retired urban planner and an accomplished jazz and blues guitarist.',

  'gerard-sarnat':
    'Gerard Sarnat\'s authored *HOMELESS CHRONICLES*, *Disputes*, *17s*, *Melting Ice King*. Gerry\'s published by Rattle, Gargoyle, Newark Public Library, Blue Minaret, Columbia, Penn, Harvard, Brown, Yale, Pomona, Johns Hopkins, Stanford, Main-Street Rag, New Delta/ North Meridian/ Northampton/ Brooklyn/ LA/Buddhist Reviews, American Journal Poetry, Poetry Quarterly, SF Magazine, NY Times gerardsarnat.com',

  'l-m-scarpitto':
    'L.M. Scarpitto is an American poet whose work explores the human experience through nature, spirituality, and philosophical observation. Her work has appeared in various publications, with much of its inspiration drawn from her family, community, and academic background in human psychology.',

  'anna-scott':
    'Anna Scott is a poet from Michigan living in the Mountain West. She is the 2023 recipient of the American Academy of Poets Laureen Rita Schipsi Prize and the Johns Hopkins Danielle Alyse Basford Writing Prize. Her work has appeared in Timber, Feral, poets.org, and elsewhere.',

  'hibah-shabkhez':
    'Hibah Shabkhez is a writer and photographer from Lahore, Pakistan. Her work has previously appeared in Arc Poetry, Meniscus, Thimble, Harpur Palate, and a number of other literary magazines. Studying life, languages, and literature from a comparative perspective across linguistic and cultural boundaries holds a particular fascination for her.',

  'veronica-tucker':
    'Veronica Tucker is an emergency medicine physician, writer, and mother of three living in the Lakes Region of New Hampshire. Her writing has appeared in The Offing, ONE ART, American Poetry Journal, and elsewhere, and her work has received Pushcart Prize and Best of the Net nominations. Her chapbook, *The House as Witness*, was published by Quillkeepers Press in 2026.',

  'amanda-vega':
    'Amanda Vega is a writer based in South Carolina. Her work explores family, folklore, domestic life, memory, and the uncanny.',

  'huina-zheng':
    'Huina Zheng either writes as an admission coach at work or writes for fun after work. She lives in Guangzhou, China, with her family.',
};

// ── Credentials & JWT ─────────────────────────────────────────────────────────

function getKeychain(service) {
  return execSync(`security find-generic-password -s "${service}" -w`, {
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString().trim();
}

const ADMIN_KEY = getKeychain('ghost-admin-inkhorn');
const GHOST_URL = getKeychain('ghost-url-inkhorn').replace(/\/$/, '');

function makeJWT() {
  const [id, hexSecret] = ADMIN_KEY.split(':');
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid: id, typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig     = crypto.createHmac('sha256', Buffer.from(hexSecret, 'hex')).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function headers() {
  return { Authorization: `Ghost ${makeJWT()}`, 'Content-Type': 'application/json' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const slugs = Object.keys(BIOS);
  let ok = 0, errs = 0;

  for (const slug of slugs) {
    // Fetch current tag to get id and updated_at
    const getRes = await fetch(`${GHOST_URL}/ghost/api/admin/tags/slug/${encodeURIComponent(slug)}/`, {
      headers: headers(),
    });
    if (!getRes.ok) {
      console.error(`SKIP  ${slug}  (not found: HTTP ${getRes.status})`);
      errs++;
      continue;
    }
    const tag = (await getRes.json()).tags[0];

    const putRes = await fetch(`${GHOST_URL}/ghost/api/admin/tags/${tag.id}/`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ tags: [{ id: tag.id, updated_at: tag.updated_at, description: BIOS[slug] }] }),
    });
    if (!putRes.ok) {
      const text = await putRes.text();
      console.error(`ERR   ${slug}  HTTP ${putRes.status}: ${text.slice(0, 120)}`);
      errs++;
      continue;
    }
    const updated = (await putRes.json()).tags[0];
    const changed = updated.description !== tag.description ? ' (changed)' : ' (unchanged)';
    console.log(`OK    ${slug}${changed}`);
    ok++;
  }

  console.log(`\n${ok} updated, ${errs} errors.`);
})();
