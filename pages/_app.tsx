import type { AppProps } from 'next/app'
import Head from 'next/head'
import '../styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Ape-X — Job Search</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* SF Pro is system font; Inter as web fallback with similar metrics */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#F2F2F7" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
