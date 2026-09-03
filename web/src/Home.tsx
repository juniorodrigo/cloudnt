import { useState } from "preact/hooks";
import { CodeInput } from "./CodeInput.tsx";
import { recentRooms, type SavedRoom } from "./store.ts";
import { formatAge } from "./format.ts";
import { Logo } from "./Logo.tsx";
import { Icon } from "./icons.tsx";
import { currentLang, setLang, useT } from "./i18n.ts";

type Props = {
	initialCode?: string;
	onEnter: (code: string) => void;
	onCreate: () => Promise<void>;
	error?: string;
};

const REPO = "https://github.com/juniorodrigo/cloudnt";

export function Home({ initialCode, onEnter, onCreate, error }: Props) {
	const [creating, setCreating] = useState(false);
	const [recents] = useState<SavedRoom[]>(() => recentRooms());
	const t = useT();

	const create = async () => {
		setCreating(true);
		try {
			await onCreate();
		} finally {
			setCreating(false);
		}
	};

	return (
		<div class="home">
			<nav class="nav">
				<div class="wrap">
					<Logo />
					<span class="nav-spacer" />
					<a class="nav-link" href={REPO} target="_blank" rel="noreferrer noopener">
						<Icon name="github" />
						GitHub
					</a>
					<button type="button" class="btn btn-primary btn-sm" disabled={creating} onClick={create}>
						{creating ? t.home.creating : t.home.create}
					</button>
				</div>
			</nav>

			<header class="hero">
				<div class="hero-glow" aria-hidden="true" />
				<div class="wrap">
					<div class="hero-copy">
						<span class="chip">
							<span class="chip-dot" aria-hidden="true" />
							{t.home.chip}
						</span>
						<h1 class="display-xxl">
							{t.home.headline}
							<span class="hero-accent">.</span>
						</h1>
						<p class="hero-lead">{t.home.lead}</p>
						<dl class="hero-specs">
							<div>
								<dt>{t.home.specCode}</dt>
								<dd>{t.home.specCodeValue}</dd>
							</div>
							<div>
								<dt>{t.home.specWipe}</dt>
								<dd>{t.home.specWipeValue}</dd>
							</div>
							<div>
								<dt>{t.home.specFiles}</dt>
								<dd>{t.home.specFilesValue}</dd>
							</div>
						</dl>
					</div>

					<div class="join">
						<div class="join-label">{t.home.joinLabel}</div>
						<CodeInput initial={initialCode} onComplete={onEnter} invalid={Boolean(error)} />
						{error ? (
							<p class="form-error" role="alert">
								{error}
							</p>
						) : null}

						<div class="join-alt">
							<button type="button" class="btn btn-primary btn-lg" disabled={creating} onClick={create}>
								{creating ? t.home.creating : t.home.create}
							</button>
							<span class="join-alt-note">{t.home.createNote}</span>
						</div>

						{recents.length > 0 ? (
							<div class="recents">
								<h2>{t.home.recents}</h2>
								{recents.map((room) => (
									<button key={room.token} type="button" class="recent-row" onClick={() => onEnter(room.code)}>
										<span class="recent-code">{room.code}</span>
										<span class="recent-meta">
											{room.role === "owner" ? t.home.mine : t.home.guest} · {formatAge(room.savedAt)}
										</span>
									</button>
								))}
							</div>
						) : null}
					</div>
				</div>
			</header>

			<section class="section">
				<div class="wrap">
					<div class="section-head">
						<h2 class="display-lg">{t.home.stepsTitle}</h2>
						<p>{t.home.stepsLead}</p>
					</div>
					<ol class="steps">
						{t.home.steps.map((step, index) => (
							<li key={step.title} class="step">
								<span class="step-n">{String(index + 1).padStart(2, "0")}</span>
								<h3>{step.title}</h3>
								<p>{step.body}</p>
							</li>
						))}
					</ol>
				</div>
			</section>

			<section class="section">
				<div class="wrap">
					<div class="section-head">
						<h2 class="display-lg">{t.home.featuresTitle}</h2>
						<p>{t.home.featuresLead}</p>
					</div>
					<div class="spotlights">
						<article class="spotlight spotlight-violet">
							<span class="spotlight-tag">
								<Icon name="clock" />
								{t.home.wipeTag}
							</span>
							<h3>{t.home.wipeTitle}</h3>
							<p>{t.home.wipeBody}</p>
						</article>
						<article class="spotlight spotlight-orange">
							<span class="spotlight-tag">
								<Icon name="shield" />
								{t.home.approveTag}
							</span>
							<h3>{t.home.approveTitle}</h3>
							<p>{t.home.approveBody}</p>
						</article>
					</div>
					<div class="features">
						{t.home.features.map((feature) => (
							<article key={feature.label} class="feature">
								<span class="feature-top">
									<span class="feature-value">{feature.value}</span>
									<Icon name={feature.icon} class="feature-icon" />
								</span>
								<span class="feature-label">{feature.label}</span>
								<p>{feature.body}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section class="section">
				<div class="wrap">
					<div class="section-head">
						<h2 class="display-lg">{t.home.faqTitle}</h2>
						<p>{t.home.faqLead}</p>
					</div>
					<dl class="faq">
						{t.home.faq.map((item, index) => (
							<div key={item.q} class="faq-row">
								<dt>
									<span class="faq-n">{String(index + 1).padStart(2, "0")}</span>
									{item.q}
								</dt>
								<dd>{item.a}</dd>
							</div>
						))}
					</dl>
				</div>
			</section>

			<section class="section section-tight">
				<div class="wrap">
					<a class="repo-card" href={REPO} target="_blank" rel="noreferrer noopener">
						<span class="repo-tag">{t.home.repoTag}</span>
						<span class="repo-name">github.com/juniorodrigo/cloudnt</span>
						<span class="repo-body">{t.home.repoBody}</span>
						<Icon name="github" class="repo-mark" />
					</a>
				</div>
			</section>

			<footer class="site-footer">
				<div class="wrap">
					<Logo />
					<span class="footer-note">{t.home.footerNote}</span>
					<span class="nav-spacer" />
					<button
						type="button"
						class="nav-link"
						onClick={() => setLang(currentLang() === "es" ? "en" : "es")}
					>
						<Icon name="globe" />
						{t.otherLang}
					</button>
					<a class="nav-link" href={REPO} target="_blank" rel="noreferrer noopener">
						<Icon name="github" />
						GitHub
					</a>
				</div>
			</footer>
		</div>
	);
}
