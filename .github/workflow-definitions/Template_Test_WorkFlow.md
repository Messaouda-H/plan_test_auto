# .github/ISSUE_TEMPLATE/workflow_test.yml
name: Session de test — Workflow
description: Enregistrer une session de tests complete
labels: ["test-session"]

body:
  - type: dropdown
    id: workflow
    attributes:
      label: Workflow execute
      options:
        - Workflow 1, Workflow 2, Workflow 3
        # ... tous les workflows
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: Version testee
    validations:
      required: true

  - type: input
    id: fichier
    attributes:
      label: Fichier utilise (nom + format + taille)

  - type: input
    id: pc
    attributes:
      label: PC (nom + RAM + CPU)

  - type: textarea
    id: checklist
    attributes:
      label: Checklist du workflow
      description: Copier-coller la checklist du workflow et cocher chaque etape
      placeholder: |
        - [ ] NEW > charger le dossier
        - [ ] Ajuster parametres affichage
        - [ ] Zoom et scroll dans le signal
        - [ ] PSD + marquer canaux as bad
        - [ ] ...

  - type: textarea
    id: resultats
    attributes:
      label: Resultats et observations
      placeholder: Temps de chargement, comportement observe, anomalies...

  - type: dropdown
    id: statut
    attributes:
      label: Statut global
      options: ["Passe — aucun bug", "Passe avec observations", "Bug detecte — issue separee creee"]
