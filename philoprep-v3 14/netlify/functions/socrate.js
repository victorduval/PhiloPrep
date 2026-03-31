const fs = require("fs");
const path = require("path");

function stripHtmlToText(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadMethodologyDigest() {
  const candidates = [
    path.join(__dirname, "../../Fichier HTML app/Méthode de la dissertation/Méthodologie dissertation complète.html"),
    path.join(process.cwd(), "Fichier HTML app/Méthode de la dissertation/Méthodologie dissertation complète.html"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        let t = stripHtmlToText(fs.readFileSync(p, "utf8"));
        if (t.length > 100000) t = t.slice(0, 100000) + "\n…[contenu méthodologie tronqué]";
        if (t.length > 500) return t;
      }
    } catch (e) {
      /* continue */
    }
  }
  return [
    "Méthode de dissertation (résumé intégré PhiloPrep) :",
    "1) Lecture du sujet, recenser les sens possibles et tensions.",
    "2) Problématique : une question centrale claire, ouverte, qui structure tout le devoir.",
    "3) Introduction : accroche / définitions utiles / problématique annoncée / annonce de plan.",
    "4) Plan : dialectique (thèse / antithèse / synthèse) ou analytique selon le sujet ; deux ou trois grandes parties cohérentes.",
    "5) Développement : paragraphes argumentés, exemples précis, transitions, références aux auteurs du programme.",
    "6) Conclusion : bilan limité, ouverture raisonnable (sans nouveau développement massif).",
    "7) Temps d'épreuve : répartition type 4h (analyse sujet, intro, parties, relecture).",
    "Erreurs fréquentes : plan catalogage, définitions hors-sujet, digressions, conclusion bâclée.",
  ].join(" ");
}

const NAVIGATION_GUIDE = `
Application PhiloPrep — sections et chemins précis :

- Accueil : écran principal avec tuiles (Réviser, Jeux, Simulation, S'entraîner avec l'IA).
- Réviser : menu du bas ou latéral → Réviser.
  - Cours : Vue d'ensemble (panorama 17 notions), Les 17 notions (liste + fiches), Contrôles de connaissances.
  - Auteurs : fiches philosophes, citations expliquées, perspectives.
  - Méthode : méthode dissertation, dissertations corrigées.
  - Les 17 notions : ouvre la grille ; chaque notion avec fiche → « Voir le cours » ou « Tester mes connaissances » si disponible.
  - Lexique philosophique : onglet Lexique dans Réviser ou accès dédié.
- S'entraîner avec l'IA : menu → S'entraîner avec l'IA (onglet Exercices de l'écran Jeux pédagogiques).
- Jeux pédagogiques : PhiloSophia, PhiloQuest, PhiloMind, etc. ; onglet « Parcours guidé » pour le parcours pas à pas.
- Simulation Bac : écran dédié avec chronomètre (modes temps libre / 2h / 4h selon l'app).
- Paramètres : profil / thèmes.

Pour les ACTIONS automatiques côté app, termine une ligne EXACTEMENT par un tag :
[[ACTION:open_notion:CLE]]  où CLE est conscience, bonheur, inconscient, langage, liberte, technique, temps, verite, nature
[[ACTION:open_notions_list]]
[[ACTION:open_lexique]]
[[ACTION:open_methodologie]]
[[ACTION:open_synthese]]
[[ACTION:open_controles]]
[[ACTION:screen:home|reviser|sentrainer|sentrainer-ia|parcours|simulation-bac|settings]]

N'utilise qu'un tag ACTION par réponse si tu veux proposer un raccourci ; reste pédagogue dans le texte principal.
`.trim();

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "Configuration serveur : ANTHROPIC_API_KEY manquante.",
        response:
          "Je ne peux pas répondre pour l’instant : la clé API n’est pas configurée sur le serveur Netlify. Demande à l’administrateur de définir ANTHROPIC_API_KEY.",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { message, conversationHistory, knowledgeBundle } = body;
  if (!message || typeof message !== "string") {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "message requis" }) };
  }

  const history = Array.isArray(conversationHistory) ? conversationHistory : [];
  const cleanedHistory = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20);

  const methodologyDigest = loadMethodologyDigest();

  let knowledgeText = "";
  if (knowledgeBundle && typeof knowledgeBundle === "object") {
    try {
      if (knowledgeBundle.notionIndex && Array.isArray(knowledgeBundle.notionIndex)) {
        knowledgeText += "\n\nNOTIONS (index navigation) :\n" + JSON.stringify(knowledgeBundle.notionIndex, null, 0);
      }
      if (knowledgeBundle.explanations && typeof knowledgeBundle.explanations === "object") {
        knowledgeText += "\n\nCONTENU PÉDAGOGIQUE (extraits applicatifs — base pour réponses factuelles) :\n";
        const entries = Object.entries(knowledgeBundle.explanations);
        let acc = 0;
        const maxTotal = 380000;
        for (const [k, v] of entries) {
          const piece = typeof v === "string" ? v : JSON.stringify(v);
          if (acc + piece.length > maxTotal) break;
          knowledgeText += `\n--- ${k} ---\n${piece}\n`;
          acc += piece.length;
        }
      }
    } catch (e) {
      knowledgeText += "\n(Erreur lecture knowledgeBundle)\n";
    }
  }

  const systemPrompt = `${NAVIGATION_GUIDE}

Tu es **Socrate IA**, assistant officiel de PhiloPrep.

MISSIONS :
1) Guider la navigation dans l’app (chemins cliquables, étapes précises).
2) Coach méthodologique pour la dissertation : applique le digest méthodologique ci-dessous.
3) Réponses sur les notions / concepts : utilise PRIORITAIREMENT les extraits « CONTENU PÉDAGOGIQUE » et l’index des notions. Si l’information n’y figure pas clairement, dis : « Je ne trouve pas cette information dans tes cours PhiloPrep, mais je peux t’indiquer où chercher (Réviser → …) » et propose un chemin ou un [[ACTION:…]] utile.

DIGEST MÉTHODOLOGIQUE (extrait cours intégré) :
${methodologyDigest}

${knowledgeText ? knowledgeText : "(Aucun extrait client — reste prudent sur le détail des notions.)"}

RÈGLES :
- Réponds en français, ton pédagogue, clair, exigeant mais encourageant.
- Ne cite pas de sources externes non présentes dans les extraits.
- Pour ouvrir une section depuis le chat, utilise un tag [[ACTION:type:payload]] sur sa propre ligne en fin de message si pertinent.
`.trim();

  const messages = [...cleanedHistory, { role: "user", content: message }];

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      const errMsg = data.error?.message || data.message || JSON.stringify(data);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: errMsg,
          response: "Désolé, l’IA a rencontré un problème technique. Réessaie dans un instant.",
        }),
      };
    }

    const text = Array.isArray(data.content)
      ? data.content
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n")
      : "";
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ response: text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message,
        response: "Erreur serveur. Réessaie plus tard.",
      }),
    };
  }
};
