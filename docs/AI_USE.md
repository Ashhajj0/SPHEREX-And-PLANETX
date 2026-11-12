# AI use disclosure

## Tools
| Tool | Used for |
|---|---|
| Google AI Studio (Build) | Generated the website code and the Python pipeline files |
| Google Stitch | Interface design |
| Claude (Anthropic) | Project planning, writing prompts, reviewing outputs, diagnosing errors |

## Our own work
- Chose the challenge, the sky region and the science rules (null never
  zero, candidates never discoveries, everything traceable to the data).
- Ran every script on our own laptop and downloaded the real SPHEREx data.
- Reviewed the AI's outputs against documentation and against the real files.

## Problems the AI produced that we found and fixed
- A catalogue script that silently saved made-up rows when a query failed.
- A data report generated from synthetic files instead of the real ones.
- Invented content: a band table with spectral-line notes, example asteroids
  with made-up motion, and wrong detector resolving powers.
- Unsupported claims on the home page ("72 stars", "continuous coverage").
- Spectrum dips on bright stars: we traced them to saturated core pixels
  flagged OVERFLOW and now mark those points as suspect instead of hiding them.

## Prompts
Key prompts are kept in [FOLDER or LINK]. Summary: NASA's suggested prompt for
the challenge was adapted into phased prompts (data download, photometry,
export, website), each tested before the next.

## Team
[NAMES and roles]