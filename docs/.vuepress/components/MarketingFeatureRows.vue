<script setup lang="ts">
type Feature = {
  eyebrow: string
  title: string
  body: string
  image: string
  imageAlt: string
}

const features: Feature[] = [
  {
    eyebrow: 'Agents',
    title: 'Run parallel agents',
    body: 'Keep several threads in flight. Each chat stays on its own work, so one agent can review a project while another inspects the machine, without sharing a transcript.',
    image: '/features/parallel-agents.png',
    imageAlt: 'Vixl sidebar with multiple agent chats, including a resource analysis thread',
  },
  {
    eyebrow: 'Harness',
    title: 'A full coding harness',
    body: 'Tools, permissions, MCP, and skills sit in the same loop as the model. The agent reads the repo, calls tools, and leaves a trail you can inspect before the next turn.',
    image: '/features/harness.png',
    imageAlt: 'Vixl agent chat showing a documentation review with tool use in the coding harness',
  },
  {
    eyebrow: 'Editor',
    title: 'A full editor with LSP',
    body: 'Open the file beside the chat. Monaco, the file tree, and language services stay in the workspace so you and the agent are looking at the same buffer.',
    image: '/features/editor.png',
    imageAlt: 'Vixl workbench with Monaco editor, file tree, and agent chat side by side',
  },
  {
    eyebrow: 'Browser',
    title: 'A browser with CDP',
    body: 'Load a real page in the workbench. The agent can screenshot, inspect, and act on what is on screen instead of guessing from a URL in another app.',
    image: '/features/browser.png',
    imageAlt: 'Vixl in-app browser open to the Tailwind CSS homepage next to agent chat',
  },
  {
    eyebrow: 'Terminal',
    title: 'A fully integrated terminal',
    body: 'Shell sessions live in the same workspace as the chat. cwd, branch, and output stay attached to the project the agent is using.',
    image: '/features/terminal.png',
    imageAlt: 'Vixl integrated terminal next to agent chat in a project workspace',
  },
  {
    eyebrow: 'Git',
    title: 'Git flow in the workbench',
    body: 'Branch, status, and diffs stay next to the thread that produced them. Review a clean tree or open a change without leaving the agent.',
    image: '/features/git.png',
    imageAlt: 'Vixl git changes tab showing local branch status beside agent chat',
  },
]
</script>

<template>
  <section class="mt-28 w-full">
    <div class="mx-auto flex max-w-[88rem] flex-col gap-24 px-6 sm:gap-32">
      <article
        v-for="(feature, index) in features"
        :key="feature.title"
        class="feature-row grid grid-cols-1 items-start gap-x-8 gap-y-8 lg:grid-cols-2 lg:gap-x-16"
      >
        <div :class="index % 2 === 1 ? 'lg:order-2' : ''">
          <p class="text-sm font-medium text-muted-foreground">{{ feature.eyebrow }}</p>
          <h2 class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {{ feature.title }}
          </h2>
          <p class="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {{ feature.body }}
          </p>
        </div>
        <img
          :alt="feature.imageAlt"
          :class="index % 2 === 1 ? 'lg:order-1' : ''"
          :src="feature.image"
          class="w-full rounded-xl"
        />
      </article>
    </div>
  </section>
</template>
