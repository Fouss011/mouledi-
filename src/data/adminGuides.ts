export type GuideLanguage = "fr" | "mina" | "kabyè";

export type GuideStep = {
  title: string;
  body: string;
};

export type AdminGuide = {
  key: "passport" | "cni" | "casier";
  title: string;
  shortTitle: string;
  steps: GuideStep[];
  note?: string;
};

export const ADMIN_GUIDES: Record<GuideLanguage, Record<"passport" | "cni" | "casier", AdminGuide>> = {
  fr: {
    passport: {
      key: "passport",
      title: "Guide passeport",
      shortTitle: "Passeport",
      steps: [
        {
          title: "Préparer les pièces",
          body: "Prépare une pièce d’identité, un acte de naissance, des photos si demandées et tout justificatif demandé localement.",
        },
        {
          title: "Aller au service compétent",
          body: "Rends-toi au service ou centre d’enrôlement indiqué pour le passeport.",
        },
        {
          title: "Payer les frais",
          body: "Règle les frais officiels demandés et garde bien le reçu.",
        },
        {
          title: "Faire l’enrôlement",
          body: "Dépose le dossier, fais la prise d’empreintes et vérifie que tes informations sont correctes.",
        },
        {
          title: "Retirer le passeport",
          body: "Reviens avec ton reçu ou ton numéro de dossier quand le passeport est prêt.",
        },
      ],
      note: "Les pièces exactes et les frais peuvent évoluer. Vérifie toujours auprès du service officiel.",
    },
    cni: {
      key: "cni",
      title: "Guide carte nationale d’identité",
      shortTitle: "Carte d’identité",
      steps: [
        {
          title: "Préparer les documents",
          body: "Prépare ton acte de naissance, ancienne carte si tu en as une, et toute pièce complémentaire demandée.",
        },
        {
          title: "Se présenter au centre",
          body: "Va au centre d’enrôlement ou au service indiqué pour la carte d’identité.",
        },
        {
          title: "Payer si nécessaire",
          body: "Effectue le paiement officiel demandé et conserve ton reçu.",
        },
        {
          title: "Faire l’enregistrement",
          body: "Vérifie ton nom, ta date de naissance et les autres informations avant validation.",
        },
        {
          title: "Retrait",
          body: "Retire la carte dès qu’elle est disponible avec ton reçu ou ton numéro de suivi.",
        },
      ],
      note: "Ce guide est volontairement simple pour une première version de l’application.",
    },
    casier: {
      key: "casier",
      title: "Guide casier judiciaire",
      shortTitle: "Casier judiciaire",
      steps: [
        {
          title: "Identifier le bon service",
          body: "Renseigne-toi sur le tribunal, la plateforme ou le service administratif compétent.",
        },
        {
          title: "Préparer l’identité",
          body: "Prépare une pièce d’identité valide et, si demandé, l’acte de naissance ou d’autres justificatifs.",
        },
        {
          title: "Déposer la demande",
          body: "Dépose la demande sur place ou en ligne selon la procédure disponible.",
        },
        {
          title: "Payer les frais",
          body: "Paie les frais éventuels et garde la preuve de paiement.",
        },
        {
          title: "Retirer le document",
          body: "Retire le casier judiciaire ou télécharge-le lorsque la demande est validée.",
        },
      ],
      note: "Certaines démarches peuvent être digitalisées selon la zone ou le pays.",
    },
  },

  mina: {
    passport: {
      key: "passport",
      title: "Guide passeport",
      shortTitle: "Passeport",
      steps: [
        { title: "1", body: "Sɔ nu siwo woahiã la ƒo ƒu." },
        { title: "2", body: "Yi nɔƒe si wowɔa enrôlement le." },
        { title: "3", body: "Xe ga si wowobia la." },
        { title: "4", body: "Na wò nyatakakadzrawo kple wò ŋkɔ nyuie." },
        { title: "5", body: "Trɔ va xɔ passeport la ne eya ɖi." },
      ],
      note: "Version mina simplifiée pour la V1.",
    },
    cni: {
      key: "cni",
      title: "Guide carte d’identité",
      shortTitle: "Carte ID",
      steps: [
        { title: "1", body: "Sɔ pepa siwo woahiã la ƒo ƒu." },
        { title: "2", body: "Yi nɔƒe si wowɔa enregistrement le." },
        { title: "3", body: "Xe ga ne wobia." },
        { title: "4", body: "Kpɔ wò nyatakakawo ɖa nyuie hafi woaɖo." },
        { title: "5", body: "Yi xɔ carte la ne eya ɖi." },
      ],
      note: "Version mina simplifiée pour la V1.",
    },
    casier: {
      key: "casier",
      title: "Guide casier judiciaire",
      shortTitle: "Casier",
      steps: [
        { title: "1", body: "Di nɔƒe si wowɔa nu sia le." },
        { title: "2", body: "Sɔ wò pièce d’identité la yi." },
        { title: "3", body: "Na demande la ɖe asi." },
        { title: "4", body: "Xe ga ne ehiã." },
        { title: "5", body: "Trɔ va xɔ pepa la." },
      ],
      note: "Version mina simplifiée pour la V1.",
    },
  },

  kabyè: {
    passport: {
      key: "passport",
      title: "Guide passeport",
      shortTitle: "Passeport",
      steps: [
        { title: "1", body: "Prépare les pièces demandées." },
        { title: "2", body: "Va au centre prévu." },
        { title: "3", body: "Paie les frais." },
        { title: "4", body: "Fais l’enrôlement." },
        { title: "5", body: "Retire ton passeport." },
      ],
      note: "Version kabyè provisoire simplifiée pour la V1.",
    },
    cni: {
      key: "cni",
      title: "Guide carte d’identité",
      shortTitle: "Carte ID",
      steps: [
        { title: "1", body: "Prépare les documents." },
        { title: "2", body: "Rends-toi au centre." },
        { title: "3", body: "Paie si nécessaire." },
        { title: "4", body: "Vérifie les informations." },
        { title: "5", body: "Retire la carte." },
      ],
      note: "Version kabyè provisoire simplifiée pour la V1.",
    },
    casier: {
      key: "casier",
      title: "Guide casier judiciaire",
      shortTitle: "Casier",
      steps: [
        { title: "1", body: "Identifie le service compétent." },
        { title: "2", body: "Prends une pièce d’identité." },
        { title: "3", body: "Dépose la demande." },
        { title: "4", body: "Paie les frais." },
        { title: "5", body: "Retire le document." },
      ],
      note: "Version kabyè provisoire simplifiée pour la V1.",
    },
  },
};