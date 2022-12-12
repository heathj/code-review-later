import * as core from '@actions/core'
import * as github from '@actions/github'
import {GetResponseDataTypeFromEndpointMethod} from '@octokit/types'
import moment from 'moment'

async function run(): Promise<void> {
  try {
    const amountStr = core.getInput('amount')
    const amount = parseInt(amountStr, 10)
    if (isNaN(amount)) {
      core.setFailed('invalid minCodeReviewTime, please set to number')
      return
    }

    const unit = core.getInput('unit')
    if (unit !== 'h' && unit !== 'd') {
      core.setFailed('invalid unit, only "h" or "d" accepted')
      return
    }

    const {owner, repo} = github.context.repo
    const unreviewedPRs = await getUnreviewedPRsSince(owner, repo, amount, unit)
    if (unreviewedPRs.length > 0) {
      core.info(
        `The unreviewed PRs: ${JSON.stringify(
          unreviewedPRs.map(u => u.number)
        )}`
      )
      core.setFailed('There are closed PRs that need code review')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

type OctokitReturnType = ReturnType<typeof github.getOctokit>
function getOctokit(): OctokitReturnType {
  const token = core.getInput('github-token')
  return github.getOctokit(token)
}

async function getUnreviewedPRsSince(
  owner: string,
  repo: string,
  amount = 5,
  unit: 'h' | 'd' = 'h',
  config: {
    octokit: OctokitReturnType
  } = {
    octokit: getOctokit()
  }
): Promise<
  GetResponseDataTypeFromEndpointMethod<typeof config.octokit.rest.pulls.list>
> {
  let unreviewed: GetResponseDataTypeFromEndpointMethod<
    typeof config.octokit.rest.pulls.list
  > = []

  const pullsPages = config.octokit.paginate.iterator(
    config.octokit.rest.pulls.list,
    {
      owner,
      repo,
      state: 'closed'
    }
  )

  for await (const pulls of pullsPages) {
    const unreviewedPage = await Promise.all(
      pulls.data.filter(async p => {
        if (!p.merged_at) {
          core.debug(`PR has no merged_at field: ${JSON.stringify(p)}`)
          return false
        }

        if (!isAfterNow(p.merged_at, amount, unit)) {
          core.debug(`PR was merged less than ${amount} ${unit} ago`)
          return false
        }

        const reviewsPages = config.octokit.paginate.iterator(
          config.octokit.rest.pulls.listReviewComments,
          {
            owner,
            repo,
            pull_number: p.number
          }
        )
        let totalReviews = 0
        for await (const reviews of reviewsPages) {
          totalReviews += reviews.data.length
        }
        if (totalReviews > 0) {
          core.debug(`PR had ${totalReviews} reviews`)
          return false
        }
        return true
      })
    )
    unreviewed = [...unreviewed, ...unreviewedPage]
  }
  return unreviewed
}

function isAfterNow(a: string, amount: number, unit: 'h' | 'd'): boolean {
  const now = moment()
  const then = moment(a)
  then.add(amount, unit)
  return then.isSameOrAfter(now)
}

run()
