require('dotenv').config()
const BigCommerce = require('node-bigcommerce')
const jsontoxml = require('jsontoxml')
const { createClient, AuthType } = require('webdav')

const maxUrlsPerSitemap = 50000
const defaultWebdavPath = `/content/sitemaps`
const sitemapIndexFilename = 'sitemap-index.xml'

interface url {
    loc: string,
    priority?: number,
} 

interface customField {
    id: number,
    name: string,
    value: string
}

interface product {
    id: number,
    custom_url: Object,
    custom_fields: customField[]
}

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

async function getStorefrontUrl(): Promise<string|void>  {
    try {
        const res = await bigCommerceV2.get('/store')
        const { secure_url } = res
        console.log(`Storefront URL is ${secure_url}`)
        return secure_url
    } catch (err) {
        const d = new Date()
        console.error(`${d.toUTCString()} Error retrieving storefront URL`, err)
        throw err
    }
}

function getPriority(product: product): number|void {
    const priorityField = product
                    .custom_fields
                    .find(field => field
                                    .name
                                    .trim()
                                    .toLowerCase() === 'priority'),
    priority = priorityField ? priorityField.value : null
    if(priority
        && !isNaN(parseFloat(priority))
        && parseFloat(priority) >= 0
        && parseFloat(priority) <= 1) 
        return Math.round(parseFloat(priority) * 1e1 ) / 1e1
}


async function getCatalogUrls(
    type: string,
    page = 1,
    limit = 250,
    urls: url[] = []):Promise<url[]> {
    const allowedTypes = ['products', 'brands', 'categories']
    if (!allowedTypes.includes(type)) throw new Error('The requested resource requested is not supported by this method')
    const includeFields = 'custom_url'
    const isVisibleParam = type === 'products' ? '&is_visible=true' : ''
    const includeParam = type === 'products' ? '&include=custom_fields' : ''
    try {
        console.log(`Getting page ${page} of ${type} urls.`)
        const { data, meta } = await bigCommerceV3.get(`/catalog/${type}?limit=${limit}&page=${page}&include_fields=${includeFields}${isVisibleParam}${includeParam}`)

        const newUrls:url[] = data.map(record => {
            let priority = undefined
            if (type === 'products')
                priority = getPriority(record)
            return priority 
            ? {
                loc: record.custom_url.url,
                priority
            }
            : {
                loc: record.custom_url.url
            }
        })

        urls = urls.concat(newUrls)
        if (meta.pagination.total > meta.pagination.current_page) {
            page++
            return getCatalogUrls(type, page, limit, urls)
        } else {
            return urls
        }
    } catch (err) {
        const d = new Date()
        console.error(`${d.toUTCString()} Error retrieving  ${type} page ${page}`, err)
        throw err
    }
}

async function getPageUrls(
    count?: number,
    page = 1,
    limit = 250,
    urls:url[] = []): Promise<url[]>  {
    if (!count) {
        const data = await bigCommerceV2.get(`/pages/count`)
        count = data.count
    }
    // Return empty array if count is 0
    if (!count) return urls
    try {
        console.log(`Getting page ${page} of Web Page urls`)
        const pages = await bigCommerceV2.get(`/pages?limit=${limit}&page=${page}`)
        const newUrls:url[] = pages
            .filter(page => page.url ? true : false)
            .filter(page => page.is_visible ? true : false)
            .map(page => ({
                loc: page.url
            }))
        urls = urls.concat(newUrls)
        if (page * limit >= count)
            return urls
        else {
            page++
            return getPageUrls(count, page, limit, urls)
        }
    } catch (err) {const d = new Date()
        console.error(`${d.toUTCString()} Error getting page URLs`, err)
        throw err
    }
}

async function getBlogPostUrls(
    count?: number,
    page = 1,
    limit = 250,
    urls:url[] = []): Promise<url[]> {
    if (!count) {
        const data = await bigCommerceV2.get(`/blog/posts/count`)
        count = data.count
    }
    // Return empty array if count is 0
    if (!count) return urls
    try {
        console.log(`Getting page ${page} of blog post URLs.`)
        const posts = await bigCommerceV2.get(`/blog/posts?limit=${limit}&page=${page}`)
        const newUrls = posts
            .filter(post => post.is_published ? true : false)
            .map(post => ({
                loc: post.url
            }))
        urls = urls.concat(newUrls)
        if (page * limit >= count)
            return urls
        else {
            page++
            return getBlogPostUrls(count, page, limit, urls)
        }
    } catch (err) {
        const d = new Date()
        console.error(`${d.toUTCString()} Error getting blog post URLs`, err)
        throw err
    }
}

const createSitemapsFromUrls = async (urls:url[], storefrontUrl:string) => {
    console.log(`Generating and uploading sitemaps from URLs`)
    const sitemaps = []
    for (let i = 0; i < urls.length; i += maxUrlsPerSitemap) {
        const urlsChunk = urls.slice(i, (i + maxUrlsPerSitemap))
        const transformedUrls = urlsChunk.map(url => (
            {
                url
            }
        ))

        const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${jsontoxml(transformedUrls)}</urlset>`
        const filename = `pages-${i + 1}-${i + transformedUrls.length}-sitemap.xml`

        // Upload via webdav
        await webdav.putFileContents(`${defaultWebdavPath}/${filename}`, xml)
        sitemaps.push(`${storefrontUrl}${defaultWebdavPath}/${filename}`)
    }
    return sitemaps
}

const job = async () => {
    try {
        const d = new Date()
        console.log(`${d.toUTCString()} Starting job`) 
        // Create sitemaps directory in webdav if it doesn't exist
        if (await webdav.exists(defaultWebdavPath) === false) {
            await webdav.createDirectory(defaultWebdavPath)
        }

        const storefrontUrl = await getStorefrontUrl()
        if(!storefrontUrl) throw new Error('No storefront URL available, exiting')

        const productUrls = await getCatalogUrls('products'),
        blogPostUrls = await getBlogPostUrls(),
        pageUrls = await getPageUrls(),
        categoryUrls = await getCatalogUrls('categories'),
        brandUrls = await getCatalogUrls('brands'),
        allRelativeUrls:url[] = categoryUrls
            .concat(productUrls)
            .concat(brandUrls)
            .concat(pageUrls)
            .concat(blogPostUrls)
        

        const allUrls = allRelativeUrls.map(url => {
            url.loc = storefrontUrl + url.loc
            return url
        })

        const sitemaps = await createSitemapsFromUrls(allUrls, storefrontUrl)

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
        console.log(`Sitemap index: `, `${storefrontUrl}${sitemapIndexUrl}`)
    } catch (err) {
        const d = new Date()
        console.error(`${d.toUTCString()} Job failed with error`, err)
    }
}

job()


