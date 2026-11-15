// Dev only: let phones/laptops on the LAN or Tailscale load the dev bundle (Next blocks non-localhost
// origins by default, so the page renders but never hydrates). Extra hosts: NEXT_ALLOWED_DEV_ORIGINS=a,b
const extra = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
export default {
    transpilePackages: ['@faze/shared'],
    images: {
        remotePatterns: [{ protocol: 'https', hostname: 'i.ytimg.com', pathname: '/vi/**' }],
    },
    allowedDevOrigins: ['10.*.*.*', '192.168.*.*', '172.*.*.*', '100.*.*.*', '*.local', ...extra],
};
