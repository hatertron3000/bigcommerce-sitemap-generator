# BigCommerce Sitemap Generator
BigCommerce can automatically generate a single sitemap with up to 50k URLs. However, for stores with very large catalogs the 50k limit may not be high enough.

This node app will query your BC store's API to retrieve URLs for the following entities:
- Visible Products
- All Categories
- All Brands
- Web Pages Visible in the Menu
- Published Blog Posts

Products with a custom field named "priority" where the value is 0-1 will have a priority element in the url in the sitemap.

The app creates multiple XML sitemaps, a sitemap index, then uploads them your store via WebDAV where Google can access the sitemap index.

## Prerequisites
1. Node 10+
2. npm

## Usage
1. Clone the repo: `git clone https://github.com/hatertron3000/bigcommerce-sitemap-generator`
3. Navigate into the cloned directory: `cd bigcommerce-sitemap-generator`
4. Install dependencies: `npm i`
5. Make a copy of `.env.template` and name it `.env`
6. Fill in the API and WebDAV credentials. Note: The API keys need read-only access to Store Information, Products and Store Content scopes.
7. Run `npx run start`

If prompted to install the `ts-code` package, type `Y` and continue.

## TODO
- Automatically delete older sitemaps
- Create a lambda deployment package script