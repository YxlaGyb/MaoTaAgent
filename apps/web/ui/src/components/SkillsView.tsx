import { useEffect, useState } from "react";

import { useT } from "../lib/i18n.ts";
import { call, type SkillSummary } from "../lib/rpc.ts";

/// The skills a session in this directory can see, as the registry reports
/// them. Nothing here loads a body: the page answers "what is available and is
/// it open to the model", and the model reads the instructions when it needs
/// them.
export function SkillsView({ cwd }: { cwd: string }) {
  const t = useT();
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSkills(null);
    setFailed(false);
    call<{ skills?: SkillSummary[] }>("skills.list", { cwd })
      .then((reply) => {
        if (live) setSkills(reply.skills ?? []);
      })
      .catch(() => {
        if (!live) return;
        setSkills([]);
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [cwd]);

  return (
    <main className="chat">
      <header className="chat-head">
        <span className="chat-title">{t("skills")}</span>
      </header>
      <div className="plugins-body">
        {skills === null ? (
          <div className="settings-empty">{t("subagentLoading")}</div>
        ) : failed ? (
          <div className="settings-empty">{t("skillsOff")}</div>
        ) : skills.length === 0 ? (
          <div className="settings-empty">{t("noSkills")}</div>
        ) : (
          <div className="settings-card">
            {skills.map((skill) => (
              <div key={skill.name} className="settings-item">
                <div className="settings-item-text">
                  <div className="settings-item-name">{skill.name}</div>
                  <div className="settings-item-note">{skill.description}</div>
                  {skill.whenToUse === undefined ? null : (
                    <div className="settings-item-note">
                      {t("skillWhenToUse")}: {skill.whenToUse}
                    </div>
                  )}
                  <div className="settings-item-note">
                    {t("skillSource")}: {skill.source} {"· "}
                    {t("skillProvider")}: {skill.provider}
                  </div>
                  {skill.paths === undefined ? null : (
                    <div className="settings-item-note">
                      {t("skillConditional")}: {skill.paths.join(", ")} {"· "}
                      {skill.active ? t("skillActive") : t("skillInactive")}
                    </div>
                  )}
                  {skill.inert === undefined ? null : (
                    <div className="settings-item-note">
                      {t("skillInert")}: {skill.inert.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
