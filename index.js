require('dotenv').config()
const BigCommerce = require('node-bigcommerce')
const jsontoxml = require('jsontoxml')
const { createClient, AuthType } = require('webdav')

const maxUrlsPerSitemap = 50000
const sitemaps = []
const defaultWebdavPath = `/content/sitemaps`
const publicWebdavUrl = process.env.WEBDAV_URL.replace('/dav', '')

const webdav = createClient(
    process.env.WEBDAV_URL,
    {
        authType: AuthType.Digest,
        username: process.env.WEBDAV_USERNAME,
        password: process.env.WEBDAV_PASSWORD
    }
)

const bigCommerceV3 = new BigCommerce({
    logLevel: 'info',
    clientId: process.env.CLIENT_ID,
    accessToken: process.env.TOKEN,
    storeHash: process.env.STORE_HASH,
    responseType: 'json',
    headers: { 'Accept-Encoding': '*' }, // Override headers (Overriding the default encoding of GZipped is useful in development)
    apiVersion: 'v3' // Default is v2
})

const bigCommerceV2 = new BigCommerce({
    logLevel: 'info',
    clientId: process.env.CLIENT_ID,
    accessToken: process.env.TOKEN,
    storeHash: process.env.STORE_HASH,
    responseType: 'json',
    headers: { 'Accept-Encoding': '*' }, // Override headers (Overriding the default encoding of GZipped is useful in development)
    apiVersion: 'v2' // Default is v2
})

const fetchProducts = async (page, limit, includeFields) => {
    try {
        const res = await bigCommerceV3.get(`/catalog/products?limit=${limit}&page=${page}&include_fields=${includeFields}`)
        return res
    } catch (err) {
        console.error(err)
        throw err
    }
}

const getProductUrls = async (page = 1, limit = 250, urls = []) => {
    const includeFields = 'custom_url'
    try {
        const { data, meta } = await fetchProducts(page, limit, includeFields)
        const newUrls = data.map(product => product.custom_url.url)
        urls = urls.concat(newUrls)
        if (meta.pagination.total > meta.pagination.current_page) {
            page++
            return getProductUrls(page, limit, urls)
        } else {
            return urls
        }
    } catch (err) {
        console.error(err)
        throw err
    }
}

const job = async () => {
    try {
        // Create sitemaps directory in webdav if it doesn't exist
        if (await webdav.exists(defaultWebdavPath) === false) {
            await webdav.createDirectory(defaultWebdavPath)
        }
        // Create Product Sitemaps
        const productUrls = await getProductUrls()
        for (let i = 0; i < productUrls.length; i += maxUrlsPerSitemap) {
            const urlsChunk = productUrls.slice(i, (i + maxUrlsPerSitemap))
            const transformedUrls = urlsChunk.map(url => (
                {
                    url: {
                        loc: url
                    }
                }
            ))

            const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${jsontoxml(transformedUrls)}</urlset>`
            const filename = `products-${i + 1}-${i + transformedUrls.length}-sitemap.xml`
            // Upload Products sitemaps
            await webdav.putFileContents(`${defaultWebdavPath}/${filename}`, xml)
            sitemaps.push(`${publicWebdavUrl}${defaultWebdavPath}/${filename}`)
        }

        // TODO Create/upload categories sitemap
        // TODO Create/upload brands sitemaps

        // create sitemap index
        const sitemapsJson = sitemaps.map(sitemap => (
            {
                sitemap: {
                    loc: sitemap
                }
            }
        ))
        const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${jsontoxml(sitemapsJson)}</sitemapindex>`
        const sitemapIndexUrl = `${defaultWebdavPath}/sitemap-index.xml`

        // Upload sitemap index
        await webdav.putFileContents(sitemapIndexUrl, sitemapIndex)


        console.log(`Total Product URLs: ${productUrls.length}`)
        console.log(`Individual Sitemaps: `, sitemaps)
        console.log(`Sitemap index: `, sitemapIndexUrl)
    } catch (err) {
        console.log(`Job failed with error`, err)
    }
}

job()


