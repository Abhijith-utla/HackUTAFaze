import Link from "next/link";
export default function Home() {
  return (<div className="card"><h1>Collect. Open. Trade.</h1>
    <p className="mute">Demo build. Coins have no cash value.</p>
    <Link className="btn" href="/store">Open the store</Link></div>);
}
