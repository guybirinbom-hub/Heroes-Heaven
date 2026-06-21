import { useState } from 'react';
import { buildCharacter, type BuildState } from '../../rules/build';
import type { Character, ContentDatabase } from '../../rules/types';
import { AttributeEditor, type BuilderActions, LiveStats, OriginPickers, SkillEditor } from '../shared';

interface Props {
  build: BuildState;
  actions: BuilderActions;
  content: ContentDatabase;
  onCreate: (c: Character) => void;
}

const STEPS = ['Origin', 'Attributes', 'Skills', 'Review'];

export function WizardBuilder({ build, actions, content, onCreate }: Props) {
  const [step, setStep] = useState(0);

  return (
    <>
      <div className="wiz-steps">
        {STEPS.map((s, i) => (
          <span className="wiz-step" key={s}>
            {i < step ? (
              <i className="ti ti-circle-check" style={{ color: 'var(--app-good)' }} aria-hidden="true" />
            ) : (
              <span className={'wiz-num' + (i === step ? ' on' : '')}>{i + 1}</span>
            )}
            <span className={i === step ? 'wiz-cur' : ''}>{s}</span>
            {i < STEPS.length - 1 && <i className="ti ti-chevron-right wiz-arrow" aria-hidden="true" />}
          </span>
        ))}
      </div>

      <div className="wiz-body">
        <div className="card-sec">
          {step === 0 && (
            <>
              <div className="wiz-h">Choose your origin</div>
              <OriginPickers build={build} actions={actions} content={content} />
            </>
          )}
          {step === 1 && (
            <>
              <div className="wiz-h">Assign your attributes</div>
              <AttributeEditor build={build} actions={actions} content={content} />
            </>
          )}
          {step === 2 && (
            <>
              <div className="wiz-h">Choose trained skills</div>
              <SkillEditor build={build} actions={actions} content={content} />
            </>
          )}
          {step === 3 && (
            <>
              <div className="wiz-h">Review</div>
              <LiveStats build={build} content={content} />
            </>
          )}
        </div>
      </div>

      <div className="wiz-nav">
        <button className="b-cancel" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <i className="ti ti-arrow-left" aria-hidden="true" /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button className="b-create" onClick={() => setStep((s) => s + 1)}>
            Next <i className="ti ti-arrow-right" aria-hidden="true" />
          </button>
        ) : (
          <button className="b-create" onClick={() => onCreate(buildCharacter(build, content))}>
            Create character
          </button>
        )}
      </div>
    </>
  );
}
