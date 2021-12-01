import * as React from 'react'
import { GitHubRepository } from '../../models/github-repository'
import { IDisposable } from 'event-kit'
import { Dispatcher } from '../dispatcher'
import {
  getCheckRunConclusionAdjective,
  ICombinedRefCheck,
  IRefCheck,
  getCheckRunStepURL,
  getCheckStatusCountMap,
} from '../../lib/ci-checks/ci-checks'
import { Octicon, syncClockwise } from '../octicons'
import { Button } from '../lib/button'
import { APICheckConclusion, IAPIWorkflowJobStep } from '../../lib/api'
import { Popover, PopoverCaretPosition } from '../lib/popover'
import { CICheckRunList } from './ci-check-run-list'
import { encodePathAsUrl } from '../../lib/path'
import { PopupType } from '../../models/popup'
import * as OcticonSymbol from '../octicons/octicons.generated'

const BlankSlateImage = encodePathAsUrl(
  __dirname,
  'static/empty-no-pull-requests.svg'
)

interface ICICheckRunPopoverProps {
  readonly dispatcher: Dispatcher

  /** The GitHub repository to use when looking up commit status. */
  readonly repository: GitHubRepository

  /** The current branch name. */
  readonly branchName: string

  /** The pull request's number. */
  readonly prNumber: number

  /** The bottom of the pull request badge so we can position popover relative
   * to it. */
  readonly badgeBottom: number

  /** Callback for when popover closes */
  readonly closePopover: (event?: MouseEvent) => void
}

interface ICICheckRunPopoverState {
  readonly checkRuns: ReadonlyArray<IRefCheck>
  readonly checkRunSummary: string
  readonly loadingActionLogs: boolean
  readonly loadingActionWorkflows: boolean
}

/** The CI Check Runs Popover. */
export class CICheckRunPopover extends React.PureComponent<
  ICICheckRunPopoverProps,
  ICICheckRunPopoverState
> {
  private statusSubscription: IDisposable | null = null

  public constructor(props: ICICheckRunPopoverProps) {
    super(props)

    this.state = {
      checkRuns: [],
      checkRunSummary: '',
      loadingActionLogs: true,
      loadingActionWorkflows: true,
    }
  }

  public componentDidMount() {
    const combinedCheck = this.props.dispatcher.tryGetCommitStatus(
      this.props.repository,
      this.getCommitRef(this.props.prNumber),
      this.props.branchName
    )

    this.onStatus(combinedCheck)
    this.subscribe()
  }

  public componentWillUnmount() {
    this.unsubscribe()
  }

  private subscribe() {
    this.unsubscribe()

    this.statusSubscription = this.props.dispatcher.subscribeToCommitStatus(
      this.props.repository,
      this.getCommitRef(this.props.prNumber),
      this.onStatus,
      this.props.branchName
    )
  }

  private unsubscribe() {
    if (this.statusSubscription) {
      this.statusSubscription.dispose()
      this.statusSubscription = null
    }
  }

  private onStatus = async (check: ICombinedRefCheck | null) => {
    const checkRuns = check !== null ? check.checks : []
    this.setState({
      checkRuns: [...checkRuns],
      checkRunSummary: this.getCombinedCheckSummary(check),
      loadingActionWorkflows: check === null,
      loadingActionLogs: check === null,
    })
  }

  private onViewCheckDetails = (checkRun: IRefCheck): void => {
    if (checkRun.htmlUrl === null && this.props.repository.htmlURL === null) {
      // A check run may not have a url depending on how it is setup.
      // However, the repository should have one; Thus, we shouldn't hit this
      return
    }

    // Some checks do not provide htmlURLS like ones for the legacy status
    // object as they do not have a view in the checks screen. In that case we
    // will just open the PR and they can navigate from there... a little
    // dissatisfying tho more of an edgecase anyways.
    const url =
      checkRun.htmlUrl ??
      `${this.props.repository.htmlURL}/pull/${this.props.prNumber}`

    this.props.dispatcher.openInBrowser(url)
  }

  private onViewJobStep = (
    checkRun: IRefCheck,
    step: IAPIWorkflowJobStep
  ): void => {
    const { repository, prNumber, dispatcher } = this.props

    const url = getCheckRunStepURL(checkRun, step, repository, prNumber)

    if (url !== null) {
      dispatcher.openInBrowser(url)
    }
  }

  private getCommitRef(prNumber: number): string {
    return `refs/pull/${prNumber}/head`
  }

  private getCombinedCheckSummary(
    combinedCheck: ICombinedRefCheck | null
  ): string {
    if (combinedCheck === null || combinedCheck.checks.length === 0) {
      return ''
    }

    const { checks } = combinedCheck
    const conclusionMap = new Map<string, number>()
    for (const check of checks) {
      const adj = getCheckRunConclusionAdjective(
        check.conclusion
      ).toLocaleLowerCase()
      conclusionMap.set(adj, (conclusionMap.get(adj) ?? 0) + 1)
    }

    const summaryArray = []
    for (const [conclusion, count] of conclusionMap.entries()) {
      summaryArray.push({ count, conclusion })
    }

    if (summaryArray.length > 1) {
      const output = summaryArray.map(
        ({ count, conclusion }) => `${count} ${conclusion}`
      )
      return `${output.slice(0, -1).join(', ')}, and ${output.slice(-1)} checks`
    }

    const pluralize = summaryArray[0].count > 1 ? 'checks' : 'check'
    return `${summaryArray[0].count} ${summaryArray[0].conclusion} ${pluralize}`
  }

  private rerunChecks = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CICheckRunRerun,
      checkRuns: this.state.checkRuns,
      repository: this.props.repository,
      prRef: this.getCommitRef(this.props.prNumber),
    })
  }

  private getPopoverPositioningStyles = (): React.CSSProperties => {
    const top = this.props.badgeBottom + 10
    return { top, maxHeight: `calc(100% - ${top + 10}px)` }
  }

  private getListHeightStyles = (): React.CSSProperties => {
    const headerHeight = 55
    return {
      maxHeight: `${
        window.innerHeight - (this.props.badgeBottom + headerHeight + 20)
      }px`,
    }
  }

  private renderRerunButton = () => {
    const { checkRuns } = this.state
    return (
      <Button
        onClick={this.rerunChecks}
        disabled={checkRuns.length === 0 || this.state.loadingActionWorkflows}
      >
        <Octicon symbol={syncClockwise} /> Re-run checks
      </Button>
    )
  }

  private renderCheckRunLoadings(): JSX.Element {
    return (
      <div className="loading-check-runs">
        <img src={BlankSlateImage} className="blankslate-image" />
        <div className="title">Stand By</div>
        <div className="call-to-action">Check runs incoming!</div>
      </div>
    )
  }

  private renderCompletenessIndicator(): JSX.Element {
    if (this.state.checkRuns.length === 0) {
      return <Octicon symbol={syncClockwise} className="spin" />
    }

    const allSucccess = !this.state.checkRuns.some(
      v => v.conclusion !== APICheckConclusion.Success
    )
    if (allSucccess) {
      return (
        <Octicon
          className={'completeness-indicator-success'}
          symbol={OcticonSymbol.checkCircleFill}
        />
      )
    }

    const allFailure = !this.state.checkRuns.some(
      v =>
        v.conclusion === null ||
        ![
          APICheckConclusion.Failure,
          APICheckConclusion.Canceled,
          APICheckConclusion.ActionRequired,
          APICheckConclusion.TimedOut,
        ].includes(v.conclusion)
    )

    if (allFailure) {
      return (
        <Octicon
          className={'completeness-indicator-error'}
          symbol={OcticonSymbol.xCircleFill}
        />
      )
    }

    const { paths, className, height, width } = donutSVG(
      getCheckStatusCountMap(this.state.checkRuns)
    )
    const svgPaths = paths.map((p, i) => {
      return <path key={i} className={p.name} d={p.path} />
    })
    const viewBox = `0 0 ${width} ${height}`
    return (
      <svg className={className} version="1.1" viewBox={viewBox} tabIndex={-1}>
        {svgPaths}
      </svg>
    )
  }

  public render() {
    const {
      checkRunSummary,
      checkRuns,
      loadingActionLogs,
      loadingActionWorkflows,
    } = this.state

    return (
      <div className="ci-check-list-popover">
        <Popover
          caretPosition={PopoverCaretPosition.Top}
          onClickOutside={this.props.closePopover}
          style={this.getPopoverPositioningStyles()}
        >
          <div className="ci-check-run-list-header">
            <div className="completeness-indicator">
              {this.renderCompletenessIndicator()}
            </div>
            <div className="ci-check-run-list-title-container">
              <div className="title">Checks Summary</div>
              <div className="check-run-list-summary">{checkRunSummary}</div>
            </div>
            {this.renderRerunButton()}
          </div>
          {!loadingActionLogs ? (
            <div
              className="ci-check-run-list"
              style={this.getListHeightStyles()}
            >
              <CICheckRunList
                checkRuns={checkRuns}
                loadingActionLogs={loadingActionLogs}
                loadingActionWorkflows={loadingActionWorkflows}
                onViewCheckDetails={this.onViewCheckDetails}
                onViewJobStep={this.onViewJobStep}
              />
            </div>
          ) : (
            this.renderCheckRunLoadings()
          )}
        </Popover>
      </div>
    )
  }
}

function donutSVG(
  donutValuesMap: Map<string, number>,
  outerRadius: number = 15,
  innerRadius: number = 9
) {
  const diameter = outerRadius * 2
  const sum = [...donutValuesMap.values()].reduce((sum, v) => sum + v)

  const cx = diameter / 2
  const cy = cx

  const paths: { name: string; path: string }[] = []
  let cumulative = 0

  for (const [name, value] of [...donutValuesMap.entries()]) {
    if (value === 0) {
      continue
    }

    const portion = value / sum

    if (portion === 1) {
      const x2 = cx - 0.01
      const y1 = cy - outerRadius
      const y2 = cy - innerRadius
      const d = ['M', cx, y1]
      d.push('A', outerRadius, outerRadius, 0, 1, 1, x2, y1)
      d.push('L', x2, y2)
      d.push('A', innerRadius, innerRadius, 0, 1, 0, cx, y2)
      paths.push({ name, path: d.join(' ') })
      continue
    }

    const cumulative_plus_value = cumulative + value

    const d = ['M', ...scale(cumulative, outerRadius, cx, sum)]
    d.push('A', outerRadius, outerRadius, 0)
    d.push(portion > 0.5 ? 1 : 0)
    d.push(1)
    d.push(...scale(cumulative_plus_value, outerRadius, cx, sum))
    d.push('L')

    d.push(...scale(cumulative_plus_value, innerRadius, cx, sum))
    d.push('A', innerRadius, innerRadius, 0)
    d.push(portion > 0.5 ? 1 : 0)
    d.push(0)
    d.push(...scale(cumulative, innerRadius, cx, sum))

    cumulative += value

    paths.push({ name, path: d.join(' ') })
  }

  return {
    paths,
    height: diameter,
    width: diameter,
    className: 'donut-chart',
  }
}

function scale(
  value: number,
  radius: number,
  cxy: number,
  sum: number
): ReadonlyArray<number> {
  const radians = (value / sum) * Math.PI * 2 - Math.PI / 2
  return [radius * Math.cos(radians) + cxy, radius * Math.sin(radians) + cxy]
}
