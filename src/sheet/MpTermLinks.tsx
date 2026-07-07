import type { ReactNode } from 'react';
import type { MpProperty } from '../rules/monsterParts';
import { getMpProperty } from '../rules/monsterParts';
import { mpPathDesc, mpPropertyDesc } from '../rules/monsterPartsGlossary';
import { InfoTerm } from './InfoTerm';

/**
 * Clickable Monster-Parts PATH name (Magic / Might / Technique / main) — opens an authored description
 * of what that imbuement path means, via the app's standard InfoTerm → DescriptionModal popup (pinnable,
 * drill-in). `children` defaults to the path's display name.
 */
export function MpPathTerm({ pathId, children, className }: { pathId: string; children?: ReactNode; className?: string }) {
  const desc = mpPathDesc(pathId);
  return (
    <InfoTerm title={desc?.title ?? pathId} description={desc?.description} className={className} descKey="mp-path">
      {children ?? desc?.title ?? pathId}
    </InfoTerm>
  );
}

/**
 * Clickable Monster-Parts PROPERTY name (Fire, Sonic, Charisma, …) — opens a catalog-sourced description
 * (requirement + effect + per-path level ladder) so the popup can't drift from the mechanics. Accepts
 * either a resolved property or a property id; renders plain text if the id is unknown.
 */
export function MpPropertyTerm({
  prop,
  propertyId,
  children,
  className,
}: {
  prop?: MpProperty;
  propertyId?: string;
  children?: ReactNode;
  className?: string;
}) {
  const p = prop ?? (propertyId ? getMpProperty(propertyId) : undefined);
  if (!p) return <span className={className}>{children ?? propertyId}</span>;
  const desc = mpPropertyDesc(p);
  return (
    <InfoTerm title={desc.title} description={desc.description} className={className} descKey="mp-property">
      {children ?? p.name}
    </InfoTerm>
  );
}
