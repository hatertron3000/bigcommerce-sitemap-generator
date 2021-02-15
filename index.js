require('dotenv').config()
const BigCommerce = require('node-bigcommerce')
const jsontoxml = require('jsontoxml')
const { createClient, AuthType } = require('webdav')

const maxUrlsPerSitemap = 50000
const defaultWebdavPath = `/content/sitemaps`
const sitemapIndexFilename = 'sitemap-index.xml'
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


const getCatalogUrls = async (type, page = 1, limit = 250, urls = []) => {
    const allowedTypes = ['products', 'brands', 'categories']
    if (!allowedTypes.includes(type)) throw new Error('The requested resource requested is not supported by this method')
    const includeFields = 'custom_url'
    const isVisibleParam = type === 'products' ? '&is_visible=true' : ''
    try {
        const { data, meta } = await bigCommerceV3.get(`/catalog/${type}?limit=${limit}&page=${page}&include_fields=${includeFields}${isVisibleParam}`)
        const newUrls = data.map(product => product.custom_url.url)
        urls = urls.concat(newUrls)
        if (meta.pagination.total > meta.pagination.current_page) {
            page++
            return getCatalogUrls(type, page, limit, urls)
        } else {
            return urls
        }
    } catch (err) {
        console.error(err)
        throw err
    }
}

const getPageUrls = async (count, page = 1, limit = 250, urls = []) => {
    if (!count) {
        const data = await bigCommerceV2.get(`/pages/count`)
        count = data.count
    }
    // Return empty array if count is 0
    if (!count) return urls
    try {
        const pages = await bigCommerceV2.get(`/pages?limit=${limit}&page=${page}`)
        const newUrls = pages
            .filter(page => page.url ? true : false)
            .map(page => page.url)
        urls = urls.concat(newUrls)
        if (page * limit >= count)
            return urls
        else {
            page++
            return getPageUrls(count, page, limit, urls)
        }
    } catch (err) {
        console.error(err)
        throw err
    }
}

const getBlogPostUrls = async (count, page = 1, limit = 250, urls = []) => {
    if (!count) {
        const data = await bigCommerceV2.get(`/blog/posts/count`)
        count = data.count
    }
    // Return empty array if count is 0
    if (!count) return urls
    try {
        const posts = await bigCommerceV2.get(`/blog/posts?limit=${limit}&page=${page}`)
        const newUrls = posts
            .map(post => post.url)
        urls = urls.concat(newUrls)
        if (page * limit >= count)
            return urls
        else {
            page++
            return getBlogPostUrls(count, page, limit, urls)
        }
    } catch (err) {
        console.error(err)
        throw err
    }
}

const createSitemapsFromUrls = async (urls) => {
    const sitemaps = []
    for (let i = 0; i < urls.length; i += maxUrlsPerSitemap) {
        const urlsChunk = urls.slice(i, (i + maxUrlsPerSitemap))
        const transformedUrls = urlsChunk.map(url => (
            {
                url: {
                    loc: url
                }
            }
        ))

        const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${jsontoxml(transformedUrls)}</urlset>`
        const filename = `pages-${i + 1}-${i + transformedUrls.length}-sitemap.xml`

        // Upload via webdav
        await webdav.putFileContents(`${defaultWebdavPath}/${filename}`, xml)
        sitemaps.push(`${publicWebdavUrl}${defaultWebdavPath}/${filename}`)
    }
    return sitemaps
}

const job = async () => {
    try {
        // Create sitemaps directory in webdav if it doesn't exist
        if (await webdav.exists(defaultWebdavPath) === false) {
            await webdav.createDirectory(defaultWebdavPath)
        }

        const blogPostUrls = await getBlogPostUrls()
        const pageUrls = await getPageUrls()
        const productUrls = await getCatalogUrls('products')
        const categoryUrls = await getCatalogUrls('categories')
        const brandUrls = await getCatalogUrls('brands')


        const allUrls = categoryUrls
            .concat(productUrls)
            .concat(brandUrls)
            .concat(pageUrls)
            .concat(blogPostUrls)

        const sitemaps = await createSitemapsFromUrls(allUrls)

        // create sitemap index
        const sitemapsJson = sitemaps.map(sitemap => (
            {
                sitemap: {
                    loc: sitemap
                }
            }
        ))
        const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${jsontoxml(sitemapsJson)}</sitemapindex>`
        const sitemapIndexUrl = `${defaultWebdavPath}/${sitemapIndexFilename}`

        // Upload sitemap index
        await webdav.putFileContents(sitemapIndexUrl, sitemapIndex)


        console.log(`Total Pages in Sitemaps: ${allUrls.length}`)
        console.log(`Individual Sitemaps: `, sitemaps)
        console.log(`Sitemap index: `, `${publicWebdavUrl}${sitemapIndexUrl}`)
    } catch (err) {
        console.log(`Job failed with error`, err)
    }
}

job()


