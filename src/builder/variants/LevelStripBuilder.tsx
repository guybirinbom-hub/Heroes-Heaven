import { buildCharacter, type BuildState } from '../../rules/build';
import type { Character, ContentDatabase } from '../../rules/types';
import { AttributeEditor, type BuilderActions, LiveStats, OriginPickers, SkillEditor } from '../shared';

interface Props {
  build: BuildState;
  actions: BuilderActions;
  content: ContentDatabase;
  onCreate: (c: Character) => void;
}

export function LevelStripBuilder({ build, actions, content, onCreate }: Props) {
  return (
    <>
      <div className="lstrip">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((lvl) => (
          <span key={lvl} className={'lchip' + (lvl === build.level ? ' on' : '')}>
            {lvl}
          </span>
        ))}
      </div>
      <div className="builder-body">
        <div className="bmain">
          <div>
            <div className="bsec-title">Level 1 — origin</div>
            <OriginPickers build={build} actions={actions} content={content} />
          </div>
          <div className="card-sec">
            <div className="bsec-title">Attributes</div>
            <AttributeEditor build={build} actions={actions} content={content} />
          </div>
          <div className="card-sec">
            <div className="bsec-title">Trained skills</div>
            <SkillEditor build={build} actions={actions} content={content} />
          </div>
        </div>
        <aside className="brail">
          <div className="brail-title">Live stats</div>
          <LiveStats build={build} content={content} />
          <div className="brail-actions">
            <button className="b-create" onClick={() => onCreate(buildCharacter(build, content))}>
              Create character
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
