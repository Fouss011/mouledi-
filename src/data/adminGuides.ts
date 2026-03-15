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
          title: "Vérifier qui peut faire la demande",
          body: "Tout citoyen togolais peut demander un passeport. Pour une première demande, il faut préparer les pièces demandées avant de commencer la procédure.",
        },
        {
          title: "Préparer les pièces",
          body: "Prépare les originaux de l’acte de naissance et du certificat de nationalité, l’attestation de personne à prévenir pour les adultes ou l’attestation parentale pour les mineurs, une copie simple de la preuve de profession ou du diplôme, une photocopie simple de la carte nationale d’identité, deux photos d’identité sur fond blanc, et si besoin l’ancien passeport ou le certificat de mariage.",
        },
        {
          title: "Pré-enregistrement et paiement",
          body: "La demande passe par la plateforme officielle puis par le dépôt du dossier. Le coût officiel affiché pour la demande de passeport est de 30 000 F CFA. Garde bien la quittance ou la preuve de paiement.",
        },
        {
          title: "Dépôt et enrôlement",
          body: "Après la demande en ligne, rends-toi au lieu indiqué avec les pièces pour le contrôle du dossier et l’enrôlement. Vérifie bien ton nom, ta date de naissance et toutes tes informations avant validation.",
        },
        {
          title: "Suivi et retrait",
          body: "Quand le passeport est prêt, retire-le selon les indications données par le service compétent. Conserve ton reçu et ton numéro de dossier jusqu’au retrait final.",
        },
      ],
      note: "Les exigences peuvent évoluer selon la situation du demandeur. Vérifie toujours la procédure officielle avant de te déplacer.",
    },

    cni: {
      key: "cni",
      title: "Guide carte nationale d’identité",
      shortTitle: "Carte d’identité",
      steps: [
        {
          title: "Vérifier la démarche",
          body: "La première demande de carte nationale d’identité concerne tout citoyen togolais. La procédure indiquée par le portail officiel n’est pas encore dématérialisée : il faut se rendre au guichet physique.",
        },
        {
          title: "Préparer les documents de base",
          body: "Prépare l’original de l’acte de naissance, l’original du certificat de nationalité togolaise, la preuve de profession ou de diplôme, et un certificat du test de groupage.",
        },
        {
          title: "Ajouter les pièces selon la situation",
          body: "Selon le cas, ajoute un acte de mariage pour les femmes mariées, un certificat de divorce pour les personnes divorcées, ou un acte de décès du conjoint pour les veuves.",
        },
        {
          title: "Aller au centre compétent",
          body: "Présente-toi au guichet ou centre indiqué avec les originaux demandés. Avant validation, vérifie attentivement le nom, la date de naissance et les autres informations saisies.",
        },
        {
          title: "Attendre puis retirer la carte",
          body: "Après l’enregistrement, conserve ton reçu ou ton numéro de suivi. Reviens retirer la carte dès qu’elle est disponible selon les indications du service.",
        },
      ],
      note: "Cette version est simplifiée pour l’application, mais elle suit les grandes lignes de la procédure officielle.",
    },

    casier: {
      key: "casier",
      title: "Guide casier judiciaire",
      shortTitle: "Casier judiciaire",
      steps: [
        {
          title: "Identifier le bon service",
          body: "Le casier judiciaire permet d’obtenir notamment le bulletin n°3 ou une attestation de non-condamnation selon le besoin.",
        },
        {
          title: "Préparer l’identité",
          body: "Prépare les informations et pièces d’identité demandées par le service avant de lancer la procédure.",
        },
        {
          title: "Faire la demande",
          body: "La demande peut être initiée via le service public selon la procédure disponible pour le type de casier demandé.",
        },
        {
          title: "Choisir le retrait",
          body: "Renseigne ton identité, la méthode de retrait et ton contact selon les étapes de la procédure.",
        },
        {
          title: "Retirer le document",
          body: "Retire ou récupère le document dès que la demande est validée, en gardant bien la référence du dossier.",
        },
      ],
      note: "Selon le type de casier demandé, les modalités exactes peuvent varier.",
    },
  },

  mina: {
    passport: {
      key: "passport",
      title: "Guide passeport",
      shortTitle: "Passeport",
      steps: [
        {
          title: "Vérifier qui peut faire la demande",
          body: "Tout citoyen togolais peut demander un passeport. Pour une première demande, il faut préparer les pièces demandées avant de commencer la procédure.",
        },
        {
          title: "Préparer les pièces",
          body: "Prépare les originaux de l’acte de naissance et du certificat de nationalité, l’attestation de personne à prévenir pour les adultes ou l’attestation parentale pour les mineurs, une copie simple de la preuve de profession ou du diplôme, une photocopie simple de la carte nationale d’identité, deux photos d’identité sur fond blanc, et si besoin l’ancien passeport ou le certificat de mariage.",
        },
        {
          title: "Pré-enregistrement et paiement",
          body: "La demande passe par la plateforme officielle puis par le dépôt du dossier. Le coût officiel affiché pour la demande de passeport est de 30 000 F CFA. Garde bien la quittance ou la preuve de paiement.",
        },
        {
          title: "Dépôt et enrôlement",
          body: "Après la demande en ligne, rends-toi au lieu indiqué avec les pièces pour le contrôle du dossier et l’enrôlement. Vérifie bien ton nom, ta date de naissance et toutes tes informations avant validation.",
        },
        {
          title: "Suivi et retrait",
          body: "Quand le passeport est prêt, retire-le selon les indications données par le service compétent. Conserve ton reçu et ton numéro de dossier jusqu’au retrait final.",
        },
      ],
      note: "Texte affiché en français. L’audio pourra être joué en mina dans l’écran Guide.",
    },

    cni: {
      key: "cni",
      title: "Guide carte nationale d’identité",
      shortTitle: "Carte d’identité",
      steps: [
        {
          title: "Vérifier la démarche",
          body: "La première demande de carte nationale d’identité concerne tout citoyen togolais. La procédure indiquée par le portail officiel n’est pas encore dématérialisée : il faut se rendre au guichet physique.",
        },
        {
          title: "Préparer les documents de base",
          body: "Prépare l’original de l’acte de naissance, l’original du certificat de nationalité togolaise, la preuve de profession ou de diplôme, et un certificat du test de groupage.",
        },
        {
          title: "Ajouter les pièces selon la situation",
          body: "Selon le cas, ajoute un acte de mariage pour les femmes mariées, un certificat de divorce pour les personnes divorcées, ou un acte de décès du conjoint pour les veuves.",
        },
        {
          title: "Aller au centre compétent",
          body: "Présente-toi au guichet ou centre indiqué avec les originaux demandés. Avant validation, vérifie attentivement le nom, la date de naissance et les autres informations saisies.",
        },
        {
          title: "Attendre puis retirer la carte",
          body: "Après l’enregistrement, conserve ton reçu ou ton numéro de suivi. Reviens retirer la carte dès qu’elle est disponible selon les indications du service.",
        },
      ],
      note: "Texte affiché en français. L’audio pourra être joué en mina dans l’écran Guide.",
    },

    casier: {
      key: "casier",
      title: "Guide casier judiciaire",
      shortTitle: "Casier",
      steps: [
        {
          title: "Identifier le bon service",
          body: "Le casier judiciaire permet d’obtenir notamment le bulletin n°3 ou une attestation de non-condamnation selon le besoin.",
        },
        {
          title: "Préparer l’identité",
          body: "Prépare les informations et pièces d’identité demandées par le service avant de lancer la procédure.",
        },
        {
          title: "Faire la demande",
          body: "La demande peut être initiée via le service public selon la procédure disponible pour le type de casier demandé.",
        },
        {
          title: "Choisir le retrait",
          body: "Renseigne ton identité, la méthode de retrait et ton contact selon les étapes de la procédure.",
        },
        {
          title: "Retirer le document",
          body: "Retire ou récupère le document dès que la demande est validée, en gardant bien la référence du dossier.",
        },
      ],
      note: "Texte affiché en français. L’audio pourra être ajouté ensuite.",
    },
  },

  kabyè: {
    passport: {
      key: "passport",
      title: "Guide passeport",
      shortTitle: "Passeport",
      steps: [
        {
          title: "Vérifier qui peut faire la demande",
          body: "Tout citoyen togolais peut demander un passeport. Pour une première demande, il faut préparer les pièces demandées avant de commencer la procédure.",
        },
        {
          title: "Préparer les pièces",
          body: "Prépare les originaux de l’acte de naissance et du certificat de nationalité, l’attestation de personne à prévenir pour les adultes ou l’attestation parentale pour les mineurs, une copie simple de la preuve de profession ou du diplôme, une photocopie simple de la carte nationale d’identité, deux photos d’identité sur fond blanc, et si besoin l’ancien passeport ou le certificat de mariage.",
        },
        {
          title: "Pré-enregistrement et paiement",
          body: "La demande passe par la plateforme officielle puis par le dépôt du dossier. Le coût officiel affiché pour la demande de passeport est de 30 000 F CFA. Garde bien la quittance ou la preuve de paiement.",
        },
        {
          title: "Dépôt et enrôlement",
          body: "Après la demande en ligne, rends-toi au lieu indiqué avec les pièces pour le contrôle du dossier et l’enrôlement. Vérifie bien ton nom, ta date de naissance et toutes tes informations avant validation.",
        },
        {
          title: "Suivi et retrait",
          body: "Quand le passeport est prêt, retire-le selon les indications données par le service compétent. Conserve ton reçu et ton numéro de dossier jusqu’au retrait final.",
        },
      ],
      note: "Texte affiché en français. L’audio pourra être joué en kabyè ou en mina plus tard.",
    },

    cni: {
      key: "cni",
      title: "Guide carte nationale d’identité",
      shortTitle: "Carte d’identité",
      steps: [
        {
          title: "Vérifier la démarche",
          body: "La première demande de carte nationale d’identité concerne tout citoyen togolais. La procédure indiquée par le portail officiel n’est pas encore dématérialisée : il faut se rendre au guichet physique.",
        },
        {
          title: "Préparer les documents de base",
          body: "Prépare l’original de l’acte de naissance, l’original du certificat de nationalité togolaise, la preuve de profession ou de diplôme, et un certificat du test de groupage.",
        },
        {
          title: "Ajouter les pièces selon la situation",
          body: "Selon le cas, ajoute un acte de mariage pour les femmes mariées, un certificat de divorce pour les personnes divorcées, ou un acte de décès du conjoint pour les veuves.",
        },
        {
          title: "Aller au centre compétent",
          body: "Présente-toi au guichet ou centre indiqué avec les originaux demandés. Avant validation, vérifie attentivement le nom, la date de naissance et les autres informations saisies.",
        },
        {
          title: "Attendre puis retirer la carte",
          body: "Après l’enregistrement, conserve ton reçu ou ton numéro de suivi. Reviens retirer la carte dès qu’elle est disponible selon les indications du service.",
        },
      ],
      note: "Texte affiché en français. L’audio pourra être joué en kabyè ou en mina plus tard.",
    },

    casier: {
      key: "casier",
      title: "Guide casier judiciaire",
      shortTitle: "Casier",
      steps: [
        {
          title: "Identifier le bon service",
          body: "Le casier judiciaire permet d’obtenir notamment le bulletin n°3 ou une attestation de non-condamnation selon le besoin.",
        },
        {
          title: "Préparer l’identité",
          body: "Prépare les informations et pièces d’identité demandées par le service avant de lancer la procédure.",
        },
        {
          title: "Faire la demande",
          body: "La demande peut être initiée via le service public selon la procédure disponible pour le type de casier demandé.",
        },
        {
          title: "Choisir le retrait",
          body: "Renseigne ton identité, la méthode de retrait et ton contact selon les étapes de la procédure.",
        },
        {
          title: "Retirer le document",
          body: "Retire ou récupère le document dès que la demande est validée, en gardant bien la référence du dossier.",
        },
      ],
      note: "Texte affiché en français. L’audio pourra être ajouté ensuite.",
    },
  },
};