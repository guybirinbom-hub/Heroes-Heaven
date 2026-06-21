import { buildCharacter, type BuildState } from '../../rules/build';
import type { Character, ContentDatabase } from '../../rules/types';
import { AttributeEditor, type BuilderActions, LiveStats, OriginPickers, SkillEditor } from '../shared';

interface Props {
  build: BuildState;
  actions: BuilderActions;
  content: ContentDatabase;
  onCreate: (c: Character) => void;
}

export function SinglePageBuilder({ build, actions, content, onCreate }: Props) {
  return (
    <div className="builder-body">
      <div className="bmain">
        <div className="sp-sec">
          <div className="bsec-title">Origin</div>
          <OriginPickers build={build} actions={actions} content={content} />
        </div>
        <div className="sp-sec">
          <div className="bsec-title">Attributes</div>
          <AttributeEditor build={build} actions={actions} content={content} />
        </div>
        <div className="sp-sec">
          <div className="bsec-title">Trained skills</div>
          <SkillEditor build={build} actions={actions} content={content} />
        </div>
      </div>
      <aside className="brail">
        <div className="brail-title">Live preview</div>
        <LiveStats build={build} content={content} />
        <div className="brail-actions">
          <button className="b-create" onClick={() => onCreate(buildCharacter(build, content))}>
            Create character
          </button>
        </div>
      </aside>
    </div>
  );
}
