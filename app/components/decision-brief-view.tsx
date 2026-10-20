import type { DecisionBrief } from '~/lib/decision-brief'

export const hasDecisionBrief = (brief: DecisionBrief) => !!(brief.context || brief.options.length || brief.recommendation)

// Studio's reading column: context first, choices on hairlines, then the proposed
// direction. A recommendation stays explicitly separate from the recorded answer.
export function DecisionBriefView({ brief }: { brief: DecisionBrief }) {
  const recommended = brief.options.find((option) => option.id === brief.recommendation)
  return <div className="brief-content">
    {brief.context && <div className="brief-context"><h4>Context</h4><p>{brief.context}</p></div>}
    {brief.options.length > 0 && <div><h4>Options considered</h4><ol className="brief-options">
      {brief.options.map((option, index) => <li key={option.id} data-recommended={option.id === brief.recommendation || undefined}>
        <div className="brief-option-title"><span className="brief-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><strong>{option.title || 'Unnamed option'}</strong>{option.id === brief.recommendation && <span className="brief-recommended">Recommended</span>}</div>
        {(option.benefits || option.tradeoffs) && <dl className="brief-comparison">{option.benefits && <div><dt>Benefits</dt><dd>{option.benefits}</dd></div>}{option.tradeoffs && <div><dt>Tradeoffs</dt><dd>{option.tradeoffs}</dd></div>}</dl>}
      </li>)}
    </ol></div>}
    {recommended && <div className="brief-recommendation"><h4>Recommendation</h4><strong>{recommended.title}</strong>{brief.reasoning && <p>{brief.reasoning}</p>}</div>}
  </div>
}
